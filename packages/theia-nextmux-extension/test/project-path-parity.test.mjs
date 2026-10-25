import assert from 'node:assert/strict';
import test from 'node:test';
import { projectFolderOpenText, projectPathLabel } from '../lib/browser/nextmux-project-path.js';

test('project path labels preserve Windows drive roots and recognize slash or mixed-separator user homes', () => {
    for (const [path, expected] of [
        ['C:\\', 'C:\\'], ['D:/', 'D:\\'], ['C:\\Users\\Alice', '~'], ['C:/Users/Alice', '~'],
        ['C:/Users/Alice/projects/one/two/three', '~\\…\\two\\three'],
        ['C:\\Users/Alice/projects\\one/two\\three/', '~\\…\\two\\three'],
        ['D:\\work\\one\\two\\three\\four', 'D:\\…\\three\\four'],
        ['C:\\UsersExtra\\Alice\\project', 'C:\\UsersExtra\\Alice\\project']
    ]) assert.equal(projectPathLabel(path), expected, path);
});

test('UNC labels retain their server and share in shallow and shortened paths', () => {
    for (const [path, expected] of [
        ['\\\\server\\share', '\\\\server\\share'],
        ['\\\\server\\share\\project', '\\\\server\\share\\project'],
        ['\\\\server\\share\\one\\two\\three\\four\\file', '\\\\server\\share\\…\\four\\file'],
        ['//服务器/项目/one/two/three/four/', '\\\\服务器\\项目\\…\\three\\four']
    ]) assert.equal(projectPathLabel(path), expected, path);
});

test('macOS and Linux home shortening and root handling stay consistent', () => {
    for (const [path, expected] of [
        ['/', '/'], ['/Users/Alice', '~'], ['/home/alice/projects/one/two/three', '~/…/two/three'],
        ['/Users/Alice/projects/one/two/three/', '~/…/two/three'], ['/work/one/two/three/four', '/…/three/four'],
        ['/UsersExtra/Alice/project', '/UsersExtra/Alice/project']
    ]) assert.equal(projectPathLabel(path), expected, path);
    assert.equal(projectFolderOpenText('en', 'Win32'), 'Open the project folder in File Explorer');
    assert.equal(projectFolderOpenText('en', 'darwin'), 'Open the project folder in Finder');
});
