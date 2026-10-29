const editor = document.querySelector('#editor');
const dialog = document.querySelector('#dialog');
const dialogTitle = document.querySelector('#dialog-title');
const dialogMessage = document.querySelector('#dialog-message');
const fileList = document.querySelector('#files');
const pathLabel = document.querySelector('#path-label');
const pathInput = document.querySelector('#path-input');
const actions = document.querySelector('#dialog-actions');
let path = null;
let savedText = '';

function readFiles() {
  try {
    const data = JSON.parse(localStorage.getItem('win11web.fs'));
    return data && data.files ? data : { files: {} };
  } catch {
    return { files: {} };
  }
}

function updateStatus() {
  const lines = editor.value.slice(0, editor.selectionStart).split('\n');
  const dirty = editor.value !== savedText;
  const filename = path ? path.split('/').pop() : '제목 없음';
  document.title = `${dirty ? '*' : ''}${filename} - 메모장`;
  document.querySelector('#name').textContent = `${dirty ? '*' : ''}${path || '제목 없음'}`;
  document.querySelector('#position').textContent = `줄 ${lines.length}, 열 ${lines.at(-1).length + 1}`;
  document.querySelector('#count').textContent = `문자 수: ${editor.value.length}`;
}

function resetDialog(title, message = '') {
  dialogTitle.textContent = title;
  dialogMessage.textContent = message;
  fileList.replaceChildren();
  actions.replaceChildren();
  pathLabel.hidden = true;
}

function addAction(label, callback, primary = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `btn${primary ? ' primary' : ''}`;
  button.textContent = label;
  button.onclick = callback;
  actions.append(button);
  return button;
}

function showError(message) {
  if (dialog.open) dialog.close();
  resetDialog('메모장', message);
  addAction('확인', () => dialog.close(), true);
  dialog.showModal();
}

function saveTo(target, afterSave) {
  const data = readFiles();
  data.files[target] = { type: 'text', content: editor.value, modified: Date.now() };
  try {
    localStorage.setItem('win11web.fs', JSON.stringify(data));
    path = target;
    savedText = editor.value;
    updateStatus();
    if (dialog.open) dialog.close();
    if (afterSave) afterSave();
  } catch {
    showError('파일을 저장할 수 없습니다. 저장 공간이 부족하거나 사용할 수 없습니다.');
  }
}

function saveFile(saveAs = false, afterSave) {
  if (path && !saveAs) {
    saveTo(path, afterSave);
    return;
  }
  if (dialog.open) dialog.close();
  resetDialog('다른 이름으로 저장', '가상 파일 시스템에서 저장할 경로를 선택하세요.');
  pathLabel.hidden = false;
  pathInput.value = path || '/문서/제목 없음.txt';
  addAction('취소', () => dialog.close());
  addAction('저장', () => {
    let target = pathInput.value.trim();
    if (!target) {
      dialogMessage.textContent = '파일 경로를 입력하세요.';
      pathInput.focus();
      return;
    }
    if (!target.startsWith('/')) target = `/문서/${target}`;
    saveTo(target, afterSave);
  }, true);
  dialog.showModal();
  pathInput.focus();
  pathInput.select();
}

function withSavedChanges(callback) {
  if (editor.value === savedText) {
    callback();
    return;
  }
  resetDialog('변경 내용을 저장하시겠습니까?', '저장하지 않으면 변경 내용이 손실됩니다.');
  addAction('취소', () => dialog.close());
  addAction('저장 안 함', () => { dialog.close(); callback(); });
  addAction('저장', () => { dialog.close(); saveFile(false, callback); }, true);
  dialog.showModal();
}

function loadFile(target) {
  const file = readFiles().files[target];
  if (!file || file.type !== 'text') {
    showError('이 텍스트 파일을 찾을 수 없습니다.');
    return;
  }
  path = target;
  editor.value = file.content;
  savedText = editor.value;
  updateStatus();
  editor.focus();
}

function openFile() {
  withSavedChanges(() => {
    resetDialog('파일 열기', '가상 파일에서 텍스트 파일을 선택하세요.');
    const files = Object.entries(readFiles().files).filter(([, file]) => file.type === 'text');
    for (const [filename] of files.sort(([a], [b]) => a.localeCompare(b))) {
      const button = document.createElement('button');
      button.className = 'btn file';
      button.type = 'button';
      button.textContent = filename;
      button.onclick = () => { dialog.close(); loadFile(filename); };
      fileList.append(button);
    }
    if (!files.length) fileList.textContent = '텍스트 파일이 없습니다.';
    addAction('취소', () => dialog.close());
    dialog.showModal();
  });
}

function newFile() {
  withSavedChanges(() => {
    path = null;
    editor.value = '';
    savedText = '';
    updateStatus();
    editor.focus();
  });
}

document.querySelector('#new').onclick = newFile;
document.querySelector('#open').onclick = openFile;
document.querySelector('#save').onclick = () => saveFile();
document.querySelector('#saveas').onclick = () => saveFile(true);
document.querySelector('#wrap').onchange = event => { editor.wrap = event.target.checked ? 'soft' : 'off'; };
document.querySelector('#size').oninput = event => { editor.style.fontSize = `${Math.max(10, Math.min(48, Number(event.target.value) || 16))}px`; };
document.querySelector('#dialog-form').onsubmit = event => { event.preventDefault(); actions.querySelector('.primary')?.click(); };
for (const event of ['input', 'click', 'keyup', 'select']) editor.addEventListener(event, updateStatus);
window.addEventListener('keydown', event => {
  if (!event.ctrlKey || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === 's' || key === 'o' || key === 'n') {
    event.preventDefault();
    if (dialog.open) return;
    if (key === 's') saveFile(event.shiftKey);
    if (key === 'o') openFile();
    if (key === 'n') newFile();
  }
});
const initialPath = new URLSearchParams(location.search).get('file');
if (initialPath) loadFile(initialPath);
updateStatus();
