function calculate(source) {
  let position = 0;
  function whitespace() { while (/\s/.test(source[position] || '') && position < source.length) position++; }
  function primary() {
    whitespace();
    if (source[position] === '+' || source[position] === '-') {
      const sign = source[position++] === '-' ? -1 : 1;
      return sign * primary();
    }
    if (source[position] === '(') {
      position++;
      const value = expression();
      whitespace();
      if (source[position++] !== ')') throw new Error('닫는 괄호가 필요합니다.');
      return value;
    }
    const match = source.slice(position).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
    if (!match) throw new Error('올바른 숫자가 필요합니다.');
    position += match[0].length;
    return Number(match[0]);
  }
  function term() {
    let value = primary();
    while (true) {
      whitespace();
      const operator = source[position];
      if (operator !== '*' && operator !== '/' && operator !== '%') return value;
      position++;
      const right = primary();
      if ((operator === '/' || operator === '%') && right === 0) throw new Error('0으로 나눌 수 없습니다.');
      value = operator === '*' ? value * right : operator === '/' ? value / right : value % right;
    }
  }
  function expression() {
    let value = term();
    while (true) {
      whitespace();
      const operator = source[position];
      if (operator !== '+' && operator !== '-') return value;
      position++;
      const right = term();
      value = operator === '+' ? value + right : value - right;
    }
  }
  const result = expression();
  whitespace();
  if (position !== source.length || !Number.isFinite(result)) throw new Error('잘못된 수식입니다.');
  return result;
}
