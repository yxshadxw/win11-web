const display = document.querySelector('#display');
const expressionLine = document.querySelector('#expression');
const historyList = document.querySelector('#history-list');
let expression = '';
let result = 0;
let finished = false;
let radians = false;
let memory = 0;
let history = [];
try { history = JSON.parse(localStorage.getItem('win11web.calculator.history') || '[]'); if (!Array.isArray(history)) history = []; } catch { history = []; }
function format(value) {
  if (!Number.isFinite(value)) return '오류';
  return Number(value.toPrecision(12)).toLocaleString('en-US', { maximumFractionDigits: 12 });
}
function render() {
  expressionLine.textContent = expression.replace(/\*/g, '×').replace(/\//g, '÷');
  display.textContent = format(result);
}
function renderHistory() {
  historyList.replaceChildren();
  if (!history.length) { historyList.textContent = '아직 기록이 없습니다.'; return; }
  for (const item of history) {
    const button = document.createElement('button');
    button.className = 'history-item';
    const line = document.createElement('small'); line.textContent = item.expression + ' =';
    const value = document.createElement('strong'); value.textContent = format(item.value);
    button.append(line, value);
    button.onclick = () => { result = item.value; expression = String(result); finished = true; render(); };
    historyList.append(button);
  }
}
function saveHistory() { try { localStorage.setItem('win11web.calculator.history', JSON.stringify(history)); } catch {} }
function currentValue() { try { return calculate(expression || String(result), radians); } catch { return result; } }
function input(value) {
  if (finished) {
    expression = /^[+*/^]/.test(value) ? String(result) : '';
    finished = false;
  }
  expression += value;
  try { result = calculate(expression, radians); } catch {
    const last = expression.match(/(?:\d+\.?\d*|\.\d+)$/);
    if (last) result = Number(last[0]);
  }
  render();
}
function action(key) {
  if (key === 'C') { expression = ''; result = 0; finished = false; }
  else if (key === 'CE') { expression = expression.replace(/(?:\d+\.?\d*|\.\d+)$/, ''); result = 0; finished = false; }
  else if (key === '⌫') { expression = expression.slice(0, -1); try { result = calculate(expression, radians); } catch { result = 0; } }
  else if (key === '=') {
    try { const value = calculate(expression || String(result), radians); history.unshift({ expression: expression || String(result), value }); history = history.slice(0, 50); saveHistory(); renderHistory(); result = value; expression = String(value); finished = true; }
    catch { display.textContent = '계산할 수 없습니다'; return; }
  } else if (['±', '1/x', 'x²', '√x'].includes(key)) {
    const value = currentValue();
    const next = key === '±' ? -value : key === '1/x' ? 1 / value : key === 'x²' ? value ** 2 : Math.sqrt(value);
    if (!Number.isFinite(next)) { display.textContent = '계산할 수 없습니다'; return; }
    result = next; expression = String(next); finished = true;
  } else if (key === 'DEG' || key === 'RAD') { radians = !radians; document.querySelector('#angle').textContent = radians ? 'RAD' : 'DEG'; }
  else if (['sin', 'cos', 'tan', 'ln', 'log'].includes(key)) input(key + '(');
  else input(({ '×': '*', '÷': '/', '−': '-', 'xʸ': '^', 'n!': '!' })[key] || key);
  render();
}
function addButtons(container, labels, handler) {
  labels.forEach(label => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'btn'; button.textContent = label;
    if (/^[0-9.]$/.test(label)) button.classList.add('number');
    if (label === '=') button.classList.add('equals');
    if (label === 'DEG') button.id = 'angle';
    button.onclick = () => handler(button.textContent); container.append(button);
  });
}
addButtons(document.querySelector('#keys'), ['%', 'CE', 'C', '⌫', '1/x', 'x²', '√x', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '±', '0', '.', '='], action);
addButtons(document.querySelector('#scientific'), ['DEG', 'sin', 'cos', 'tan', 'ln', 'log', 'xʸ', 'n!', 'π', 'e', '(', ')'], action);
addButtons(document.querySelector('#memory'), ['MC', 'MR', 'M+', 'M−', 'MS', 'M'], key => {
  const value = currentValue();
  if (key === 'MC') memory = 0;
  if (key === 'MR' || key === 'M') { result = memory; expression = String(memory); finished = true; }
  if (key === 'M+') memory += value;
  if (key === 'M−') memory -= value;
  if (key === 'MS') memory = value;
  render();
});
const menu = document.querySelector('#menu');
document.querySelector('#menu-button').onclick = event => { menu.hidden = !menu.hidden; event.currentTarget.setAttribute('aria-expanded', String(!menu.hidden)); };
menu.onclick = event => { const mode = event.target.dataset.mode; if (!mode) return; document.querySelector('#mode-title').textContent = mode; document.title = mode + ' - 계산기'; document.querySelector('#scientific').hidden = mode !== '공학용'; menu.hidden = true; document.querySelector('#menu-button').setAttribute('aria-expanded', 'false'); };
document.querySelector('#history-button').onclick = event => { const open = document.querySelector('#history').classList.toggle('open'); event.currentTarget.setAttribute('aria-expanded', String(open)); };
document.querySelector('#clear-history').onclick = () => { history = []; saveHistory(); renderHistory(); };
window.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); navigator.clipboard?.writeText(String(result)).catch(() => {}); return; }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const map = { Enter: '=', '=': '=', Backspace: '⌫', Escape: 'C', Delete: 'CE', '*': '×', '/': '÷', '-': '−', '^': 'xʸ', '!': 'n!' };
  const key = map[event.key] || event.key;
  if (/^[0-9.+%()]$/.test(key) || Object.values(map).includes(key)) { event.preventDefault(); action(key); }
});
render(); renderHistory();
