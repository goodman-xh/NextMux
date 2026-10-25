import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Offline contract model for a future sharded ManagedGatewaySessionPool.
 *
 * This file intentionally does not import or modify the production session
 * implementation. It captures the invariants needed before introducing
 * sharding: a shard has a bounded active fan-out, a task keeps one immutable
 * task/idempotency identity, and accepted work cannot migrate to another
 * shard. The production implementation must make these tests pass against
 * real WebSocket fixtures before rollout.
 */
const MAX_TASKS_PER_SHARD = 16;

class SessionShardContract {
  constructor(id) { this.id = id; this.tasks = new Map(); this.frames = []; this.connected = true; }
  start(task) {
    const existing = this.tasks.get(task.taskId);
    if (existing) return { type: 'duplicate', shardId: this.id, taskId: task.taskId, idempotencyKey: existing.idempotencyKey };
    if ([...this.tasks.values()].filter(item => item.status === 'running').length >= MAX_TASKS_PER_SHARD) {
      this.frames.push({ type: 'session.error', code: 'session_task_limit', taskId: task.taskId, idempotencyKey: task.idempotencyKey });
      return { type: 'session_task_limit', preDispatch: true, shardId: this.id, taskId: task.taskId, idempotencyKey: task.idempotencyKey };
    }
    this.tasks.set(task.taskId, { ...task, shardId: this.id, status: 'running', accepted: false });
    this.frames.push({ type: 'start', taskId: task.taskId, idempotencyKey: task.idempotencyKey });
    return { type: 'accepted', preDispatch: true, shardId: this.id, taskId: task.taskId, idempotencyKey: task.idempotencyKey };
  }
  markAccepted(taskId) {
    const task = this.tasks.get(taskId); assert.ok(task, `task ${taskId} must be registered`);
    task.accepted = true;
  }
  reconnect() {
    this.connected = true;
    const frames = [...this.tasks.values()].filter(task => task.status === 'running' && task.accepted).map(task => ({ type: 'resume', taskId: task.taskId }));
    this.frames.push(...frames);
    return frames;
  }
}

class ShardPoolContract {
  constructor() { this.shards = []; }
  assign(task) {
    let shard = this.shards.find(candidate => [...candidate.tasks.values()].filter(item => item.status === 'running').length < MAX_TASKS_PER_SHARD);
    if (!shard) { shard = new SessionShardContract(`shard-${this.shards.length + 1}`); this.shards.push(shard); }
    const result = shard.start(task);
    if (result.type === 'session_task_limit') throw new Error('allocator_failed_to_find_capacity');
    return { ...result, shard };
  }
  moveBeforeDispatch(task, source) {
    // A pre-dispatch session_task_limit does not register the task on the
    // source shard. Reusing the same immutable identity on a new shard is
    // therefore safe and does not require a cancellation or migration event.
    assert.equal(source.tasks.has(task.taskId), false, 'pre-dispatch rejection must not create task ownership');
    return this.assign(task);
  }
  moveAfterAccept(task, source) {
    const existing = source.tasks.get(task.taskId);
    assert.ok(existing?.accepted, 'accepted task must remain owned by its shard');
    throw new Error('accepted_task_migration_forbidden');
  }
}

function task(index) {
  return { taskId: `task-${index}`, idempotencyKey: `contract-idempotency-${String(index).padStart(8, '0')}` };
}

test('17 unfinished tasks require exactly two shards and retain one fixed identity', () => {
  const pool = new ShardPoolContract();
  const assignments = Array.from({ length: 17 }, (_, index) => pool.assign(task(index)));
  assert.equal(pool.shards.length, 2);
  assert.deepEqual(pool.shards.map(shard => shard.tasks.size), [16, 1]);
  for (const assignment of assignments) {
    assert.equal(assignment.shard.tasks.get(assignment.taskId).idempotencyKey, assignment.idempotencyKey);
    assert.equal(assignment.shard.frames.filter(frame => frame.type === 'start' && frame.taskId === assignment.taskId).length, 1);
  }
});

test('100 unfinished tasks require seven shards with no shard over sixteen tasks', () => {
  const pool = new ShardPoolContract();
  const assignments = Array.from({ length: 100 }, (_, index) => pool.assign(task(index)));
  assert.equal(pool.shards.length, 7);
  assert.deepEqual(pool.shards.map(shard => shard.tasks.size), [16, 16, 16, 16, 16, 16, 4]);
  assert.equal(new Set(assignments.map(item => item.taskId)).size, 100);
  assert.equal(new Set(assignments.map(item => item.idempotencyKey)).size, 100);
});

test('only pre-dispatch task-limit permits moving to another shard', () => {
  const pool = new ShardPoolContract();
  const source = new SessionShardContract('full-shard');
  for (let index = 0; index < MAX_TASKS_PER_SHARD; index += 1) {
    const accepted = source.start(task(index));
    source.markAccepted(accepted.taskId);
  }
  const pending = task(16);
  const limited = source.start(pending);
  assert.equal(limited.type, 'session_task_limit');
  assert.equal(limited.preDispatch, true);
  const moved = pool.moveBeforeDispatch(pending, source);
  assert.equal(moved.type, 'accepted');
  assert.equal(moved.idempotencyKey, pending.idempotencyKey);
  assert.throws(() => pool.moveAfterAccept(task(0), source), /accepted_task_migration_forbidden/);
});

test('reconnect emits one resume per accepted task and never a second start', () => {
  const shard = new SessionShardContract('shard-1');
  for (let index = 0; index < 3; index += 1) {
    const result = shard.start(task(index));
    shard.markAccepted(result.taskId);
  }
  const startsBefore = shard.frames.filter(frame => frame.type === 'start').length;
  const resumes = shard.reconnect();
  assert.deepEqual(resumes.map(frame => frame.taskId), ['task-0', 'task-1', 'task-2']);
  assert.equal(shard.frames.filter(frame => frame.type === 'start').length, startsBefore);
  assert.equal(shard.frames.filter(frame => frame.type === 'resume').length, 3);
});
