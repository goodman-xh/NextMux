'use strict';
const http = require('node:http');

/** Local-only acceptance page shared by automated and real NM model checks. */
async function startFixture(port = 0) {
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    const child = request.url === '/frame';
    response.end(`<!doctype html><html><head><title>${child ? 'Child frame' : 'NextMux browser acceptance'}</title>
      <style>body{font:16px system-ui;padding:18px}button,input,select{margin:8px;padding:6px}#source,#destination{display:inline-block;padding:24px;border:1px solid #888;margin:12px}iframe{display:block;width:80%;height:200px}.covered{position:relative;display:inline-block}#overlay{position:absolute;inset:0;background:#ccc}</style></head><body>
      <h1>${child ? 'Cross-origin iframe' : 'NextMux browser acceptance'}</h1>
      ${child ? '<button id="frame-button" onclick="document.querySelector(\'#frame-result\').textContent=\'frame clicked\'">Frame action</button><output id="frame-result">waiting</output>' : `
      <button id="click" onclick="document.querySelector('#result').textContent='clicked'">Run action</button><output id="result">waiting</output>
      <label>Name<input id="name"></label><select id="choice" aria-label="Colour"><option value="red">Red</option><option value="blue">Blue</option></select>
      <label>Upload<input id="file" type="file" onchange="document.querySelector('#file-result').textContent=this.files[0]?.name||''"></label><output id="file-result"></output>
      <input id="hidden-file" type="file" style="display:none" aria-label="Hidden upload">
      <div id="source" draggable="true" ondragstart="event.dataTransfer.setData('text/plain','nextmux-fixture')">Drag source</div>
      <div id="destination" ondragover="event.preventDefault()" ondrop="event.preventDefault();this.textContent=event.dataTransfer.getData('text/plain')">Drop destination</div>
      <button id="later" disabled onclick="this.textContent='enabled clicked'">Delayed action</button>
      <button id="never" disabled onclick="this.textContent='unexpected click'">Cancelled action</button>
      <span class="covered"><button id="covered" onclick="this.textContent='unexpected click'">Covered action</button><span id="overlay">Overlay</span></span>
      <iframe src="http://127.0.0.1:${server.address().port}/frame"></iframe>`}</body></html>`);
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  // Both hosts resolve only to this machine. Cross-site localhost/127.0.0.1
  // forces an OOPIF when the native test starts with --site-per-process.
  return { server, url: `http://localhost:${server.address().port}/`, close: () => new Promise(resolve => server.close(resolve)) };
}
module.exports = { startFixture };
if (require.main === module) startFixture(Number(process.argv[2]) || 0).then(({ url }) => console.log(url));
