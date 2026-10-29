const codes = {
  0: ['맑음', 'clear'], 1: ['대체로 맑음', 'clouds'], 2: ['구름 조금', 'clouds'], 3: ['흐림', 'clouds'],
  45: ['안개', 'fog'], 48: ['서리 안개', 'fog'],
  51: ['약한 이슬비', 'rain'], 53: ['이슬비', 'rain'], 55: ['강한 이슬비', 'rain'],
  56: ['약한 어는 이슬비', 'rain'], 57: ['강한 어는 이슬비', 'rain'],
  61: ['약한 비', 'rain'], 63: ['비', 'rain'], 65: ['강한 비', 'rain'], 66: ['약한 어는 비', 'rain'], 67: ['강한 어는 비', 'rain'],
  71: ['약한 눈', 'snow'], 73: ['눈', 'snow'], 75: ['강한 눈', 'snow'], 77: ['싸락눈', 'snow'],
  80: ['약한 소나기', 'rain'], 81: ['소나기', 'rain'], 82: ['강한 소나기', 'rain'],
  85: ['약한 눈 소나기', 'snow'], 86: ['강한 눈 소나기', 'snow'],
  95: ['뇌우', 'thunder'], 96: ['우박을 동반한 뇌우', 'thunder'], 99: ['강한 우박을 동반한 뇌우', 'thunder']
};

export function weatherInfo(code) {
  const [label, group] = codes[code] || ['날씨 정보 없음', 'clouds'];
  return { label, group };
}
