// Countries, cities and categories.
// `ua` names are used for hashtags in the channel (posts are always Ukrainian).

export const COUNTRIES = [
  { code: 'UA', ua: 'Україна', ru: 'Украина', en: 'Ukraine',
    cities: [['Київ', 'Kyiv'], ['Харків', 'Kharkiv'], ['Одеса', 'Odesa'], ['Дніпро', 'Dnipro'],
             ['Львів', 'Lviv'], ['Запоріжжя', 'Zaporizhzhia'], ['Вінниця', 'Vinnytsia'], ['Кривий Ріг', 'Kryvyi Rih']] },
  { code: 'PL', ua: 'Польща', ru: 'Польша', en: 'Poland',
    cities: [['Варшава', 'Warsaw'], ['Краків', 'Kraków'], ['Вроцлав', 'Wrocław'], ['Гданськ', 'Gdańsk'],
             ['Познань', 'Poznań'], ['Лодзь', 'Łódź']] },
  { code: 'DE', ua: 'Німеччина', ru: 'Германия', en: 'Germany',
    cities: [['Берлін', 'Berlin'], ['Мюнхен', 'Munich'], ['Гамбург', 'Hamburg'], ['Франкфурт', 'Frankfurt'],
             ['Кельн', 'Cologne'], ['Дрезден', 'Dresden']] },
  { code: 'CZ', ua: 'Чехія', ru: 'Чехия', en: 'Czechia',
    cities: [['Прага', 'Prague'], ['Брно', 'Brno'], ['Острава', 'Ostrava'], ['Пльзень', 'Plzeň']] },
  { code: 'RO', ua: 'Румунія', ru: 'Румыния', en: 'Romania',
    cities: [['Бухарест', 'Bucharest'], ['Клуж-Напока', 'Cluj-Napoca'], ['Тімішоара', 'Timișoara'],
             ['Ясси', 'Iași'], ['Констанца', 'Constanța'], ['Брашов', 'Brașov']] },
  { code: 'IT', ua: 'Італія', ru: 'Италия', en: 'Italy',
    cities: [['Рим', 'Rome'], ['Мілан', 'Milan'], ['Неаполь', 'Naples'], ['Турин', 'Turin']] },
  { code: 'ES', ua: 'Іспанія', ru: 'Испания', en: 'Spain',
    cities: [['Мадрид', 'Madrid'], ['Барселона', 'Barcelona'], ['Валенсія', 'Valencia'], ['Аліканте', 'Alicante']] },
  { code: 'GB', ua: 'Велика Британія', ru: 'Великобритания', en: 'United Kingdom',
    cities: [['Лондон', 'London'], ['Манчестер', 'Manchester'], ['Бірмінгем', 'Birmingham'], ['Единбург', 'Edinburgh']] },
  { code: 'US', ua: 'США', ru: 'США', en: 'USA',
    cities: [['Нью-Йорк', 'New York'], ['Чикаго', 'Chicago'], ['Лос-Анджелес', 'Los Angeles'], ['Маямі', 'Miami']] },
  { code: 'CA', ua: 'Канада', ru: 'Канада', en: 'Canada',
    cities: [['Торонто', 'Toronto'], ['Монреаль', 'Montreal'], ['Ванкувер', 'Vancouver'], ['Калгарі', 'Calgary']] },
];

// price: single — одна сума; range — «від–до» (бюджет, зарплата); none — без ціни.
export const CATEGORIES = [
  { key: 'job',       tag: 'робота',        ua: '💼 Робота',          ru: '💼 Работа',            en: '💼 Job offer', price: 'range', pl: { ua: 'Зарплата', ru: 'Зарплата', en: 'Salary' } },
  { key: 'jobseek',   tag: 'шукаюроботу',   ua: '🔎 Шукаю роботу',    ru: '🔎 Ищу работу',        en: '🔎 Looking for job', price: 'range', pl: { ua: 'Бажана зарплата', ru: 'Желаемая зарплата', en: 'Desired salary' } },
  { key: 'housing',   tag: 'житло',         ua: '🏠 Житло',           ru: '🏠 Жильё',             en: '🏠 Housing', price: 'single', pl: { ua: 'Ціна', ru: 'Цена', en: 'Price' } },
  { key: 'houseseek', tag: 'шукаюжитло',    ua: '🔑 Шукаю житло',     ru: '🔑 Ищу жильё',         en: '🔑 Looking for housing', price: 'range', pl: { ua: 'Бюджет', ru: 'Бюджет', en: 'Budget' } },
  { key: 'services',  tag: 'послуги',       ua: '🛠 Послуги',         ru: '🛠 Услуги',            en: '🛠 Services', price: 'single', pl: { ua: 'Ціна', ru: 'Цена', en: 'Price' } },
  { key: 'sell',      tag: 'продам',        ua: '🏷 Продам',          ru: '🏷 Продам',            en: '🏷 For sale', price: 'single', pl: { ua: 'Ціна', ru: 'Цена', en: 'Price' } },
  { key: 'buy',       tag: 'куплю',         ua: '🛒 Куплю',           ru: '🛒 Куплю',             en: '🛒 Want to buy', price: 'range', pl: { ua: 'Бюджет', ru: 'Бюджет', en: 'Budget' } },
  { key: 'free',      tag: 'віддамдаром',   ua: '🎁 Віддам даром',    ru: '🎁 Отдам даром',       en: '🎁 Giving away', price: 'none', pl: { ua: '', ru: '', en: '' } },
  { key: 'auto',      tag: 'авто',          ua: '🚗 Авто',            ru: '🚗 Авто',              en: '🚗 Cars', price: 'single', pl: { ua: 'Ціна', ru: 'Цена', en: 'Price' } },
  { key: 'transport', tag: 'перевезення',   ua: '🚚 Перевезення',     ru: '🚚 Перевозки',         en: '🚚 Transport', price: 'single', pl: { ua: 'Ціна', ru: 'Цена', en: 'Price' } },
  { key: 'help',      tag: 'допомога',      ua: '🤝 Допомога',        ru: '🤝 Помощь',            en: '🤝 Help', price: 'none', pl: { ua: '', ru: '', en: '' } },
  { key: 'other',     tag: 'інше',          ua: '📦 Інше',            ru: '📦 Другое',            en: '📦 Other', price: 'single', pl: { ua: 'Ціна', ru: 'Цена', en: 'Price' } },
];

export function countryByCode(code) {
  return COUNTRIES.find((c) => c.code === code);
}

export function categoryByKey(key) {
  return CATEGORIES.find((c) => c.key === key);
}

// "Кривий Ріг" -> "#КривийРіг", "Клуж-Напока" -> "#КлужНапока"
export function hashtag(name) {
  return '#' + String(name).replace(/[\s\-'’ʼ`.,()]+/g, '');
}

// ── prices in UAH ──
// Stored as: 's:1800' | 'r:8000:12000' | 'r:8000:' | 'r::12000' | 'neg' | 'free' | 'none'

const fmtNum = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F');

export function parsePrice(text) {
  const t = String(text).toLowerCase();
  const nums = (t.match(/\d[\d\s.,]*/g) || [])
    .map((x) => Number(x.replace(/[\s.,]/g, '')))
    .filter((n) => n > 0 && n < 1e9);
  if (!nums.length || nums.length > 2) return null;
  const hasFrom = /(від|вiд|от|from|min)/.test(t);
  const hasTo = /(^|\s)(до|to|max)\b|(^|\s)до/.test(t);
  if (nums.length === 2) {
    const [a, b] = nums[0] <= nums[1] ? nums : [nums[1], nums[0]];
    return `r:${a}:${b}`;
  }
  if (hasFrom && !hasTo) return `r:${nums[0]}:`;
  if (hasTo && !hasFrom) return `r::${nums[0]}`;
  return `s:${nums[0]}`;
}

// Text for the post (Ukrainian). Old free-text prices are shown as typed.
export function priceText(p) {
  if (!p || p === 'none') return null;
  if (p === 'neg') return 'Договірна';
  if (p === 'free') return 'Безкоштовно';
  let m = /^s:(\d+)$/.exec(p);
  if (m) return `${fmtNum(m[1])} грн`;
  m = /^r:(\d*):(\d*)$/.exec(p);
  if (m) {
    if (m[1] && m[2]) return `${fmtNum(m[1])} – ${fmtNum(m[2])} грн`;
    if (m[1]) return `від ${fmtNum(m[1])} грн`;
    if (m[2]) return `до ${fmtNum(m[2])} грн`;
  }
  return p;
}
