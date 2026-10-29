// A small recursive descent parser; exponentiation is right associative.
function calculate(source, radians) {
  const tokens = source.match(/(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?|[a-z]+|π|[()+\-*/^!%]/gi) || [];
  if (tokens.join('').toLowerCase() !== source.replace(/\s/g, '').toLowerCase()) throw Error('잘못된 입력');
  let i = 0;
  function primary() {
    const token = tokens[i++];
    if (token === '(') {
      const value = expression();
      if (tokens[i++] !== ')') throw Error('괄호가 닫히지 않았습니다');
      return value;
    }
    if (token === 'π') return Math.PI;
    if (token === 'e') return Math.E;
    if (/^(sin|cos|tan|ln|log|sqrt)$/i.test(token || '')) {
      const name = token.toLowerCase();
      const value = primary();
      if (name === 'sqrt') return Math.sqrt(value);
      if (name === 'ln') return Math.log(value);
      if (name === 'log') return Math.log10(value);
      return Math[name](radians ? value : value * Math.PI / 180);
    }
    if (!token || !/^(?:\d|\.)/.test(token)) throw Error('숫자가 필요합니다');
    return Number(token);
  }
  function postfix() {
    let value = primary();
    while (tokens[i] === '!' || tokens[i] === '%') {
      if (tokens[i++] === '%') value /= 100;
      else {
        if (!Number.isInteger(value) || value < 0 || value > 170) throw Error('계승은 0~170 정수만');
        let result = 1;
        for (let n = 2; n <= value; n++) result *= n;
        value = result;
      }
    }
    return value;
  }
  function power() {
    let value = postfix();
    if (tokens[i] === '^') { i++; value = value ** unary(); }
    return value;
  }
  function unary() {
    if (tokens[i] === '+') { i++; return unary(); }
    if (tokens[i] === '-') { i++; return -unary(); }
    return power();
  }
  function term() {
    let value = unary();
    while (tokens[i] === '*' || tokens[i] === '/') {
      const op = tokens[i++];
      const right = unary();
      value = op === '*' ? value * right : value / right;
    }
    return value;
  }
  function expression() {
    let value = term();
    while (tokens[i] === '+' || tokens[i] === '-') {
      const op = tokens[i++];
      const right = term();
      value = op === '+' ? value + right : value - right;
    }
    return value;
  }
  const result = expression();
  if (i !== tokens.length || !Number.isFinite(result)) throw Error('계산할 수 없습니다');
  return result;
}
