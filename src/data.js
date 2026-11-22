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

export const CATEGORIES = [
  { key: 'job',       tag: 'робота',        ua: '💼 Робота',          ru: '💼 Работа',            en: '💼 Job offer' },
  { key: 'jobseek',   tag: 'шукаюроботу',   ua: '🔎 Шукаю роботу',    ru: '🔎 Ищу работу',        en: '🔎 Looking for job' },
  { key: 'housing',   tag: 'житло',         ua: '🏠 Житло',           ru: '🏠 Жильё',             en: '🏠 Housing' },
  { key: 'houseseek', tag: 'шукаюжитло',    ua: '🔑 Шукаю житло',     ru: '🔑 Ищу жильё',         en: '🔑 Looking for housing' },
  { key: 'services',  tag: 'послуги',       ua: '🛠 Послуги',         ru: '🛠 Услуги',            en: '🛠 Services' },
  { key: 'sell',      tag: 'продам',        ua: '🏷 Продам',          ru: '🏷 Продам',            en: '🏷 For sale' },
  { key: 'buy',       tag: 'куплю',         ua: '🛒 Куплю',           ru: '🛒 Куплю',             en: '🛒 Want to buy' },
  { key: 'free',      tag: 'віддамдаром',   ua: '🎁 Віддам даром',    ru: '🎁 Отдам даром',       en: '🎁 Giving away' },
  { key: 'auto',      tag: 'авто',          ua: '🚗 Авто',            ru: '🚗 Авто',              en: '🚗 Cars' },
  { key: 'transport', tag: 'перевезення',   ua: '🚚 Перевезення',     ru: '🚚 Перевозки',         en: '🚚 Transport' },
  { key: 'help',      tag: 'допомога',      ua: '🤝 Допомога',        ru: '🤝 Помощь',            en: '🤝 Help' },
  { key: 'other',     tag: 'інше',          ua: '📦 Інше',            ru: '📦 Другое',            en: '📦 Other' },
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
