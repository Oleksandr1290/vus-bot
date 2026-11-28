// Rules and privacy pages (UA / RU / EN).

export const DOCS = {
  rules: {
    ua: `<h1>Правила й безпека</h1>
<h2>Оголошення</h2><ul><li>Подавати можуть учасники спільноти: підписка на канал і участь у групі ВУС.</li><li>Одне оголошення — одна річ або послуга. Без дублікатів.</li><li>Ціна вказується в гривнях: одна ціна, «від–до» або «договірна».</li><li>Кожне оголошення перевіряє модератор. Термін — 30 днів, його можна продовжити.</li><li>Скільки оголошень на добу можна подати, залежить від програми запрошень: базово 1, кожен запрошений друг дає +1 (до 10).</li></ul>
<h2>Заборонено</h2><ul><li>Шахрайство, фінансові піраміди, «швидкий заробіток», крипто-схеми.</li><li>Наркотики, зброя, документи, порнографія, азартні ігри.</li><li>Пропаганда ворога, образи, мова ворожнечі.</li><li>Реклама інших каналів і груп.</li></ul>
<h2>Безпека угоди</h2><ul><li>Не надсилайте передоплату незнайомим людям.</li><li>Зустрічайтеся в людних місцях і перевіряйте річ до оплати.</li><li>Модератори ВУС ніколи не просять гроші, дані картки чи коди з SMS.</li><li>Підозріле оголошення? Натисніть «🚩 Поскаржитись» на сторінці оголошення.</li></ul>
<h2>Порушення</h2><p>Попередження → заборона писати на кілька годин → вічний бан. Шахраї отримують бан одразу.</p>`,
    ru: `<h1>Правила и безопасность</h1>
<h2>Объявления</h2><ul><li>Подавать могут участники сообщества: подписка на канал и участие в группе ВУС.</li><li>Одно объявление — одна вещь или услуга. Без дублей.</li><li>Цена указывается в гривнах: одна цена, «от–до» или «договорная».</li><li>Каждое объявление проверяет модератор. Срок — 30 дней, его можно продлить.</li><li>Сколько объявлений в сутки можно подать, зависит от программы приглашений: базово 1, каждый приглашённый друг даёт +1 (до 10).</li></ul>
<h2>Запрещено</h2><ul><li>Мошенничество, финансовые пирамиды, «быстрый заработок», крипто-схемы.</li><li>Наркотики, оружие, документы, порнография, азартные игры.</li><li>Пропаганда врага, оскорбления, язык вражды.</li><li>Реклама других каналов и групп.</li></ul>
<h2>Безопасность сделки</h2><ul><li>Не отправляйте предоплату незнакомым людям.</li><li>Встречайтесь в людных местах и проверяйте вещь до оплаты.</li><li>Модераторы ВУС никогда не просят деньги, данные карты или коды из SMS.</li><li>Подозрительное объявление? Нажмите «🚩 Пожаловаться» на странице объявления.</li></ul>
<h2>Нарушения</h2><p>Предупреждение → запрет писать на несколько часов → вечный бан. Мошенники получают бан сразу.</p>`,
    en: `<h1>Rules and safety</h1>
<h2>Ads</h2><ul><li>Community members can post: subscribed to the channel and in the VUS group.</li><li>One ad — one item or service. No duplicates.</li><li>Prices are in UAH: a single price, a range or “negotiable”.</li><li>Every ad is checked by a moderator. It stays up 30 days and can be extended.</li><li>How many ads you can post per day depends on the invite programme: 1 by default, +1 for every invited friend (up to 10).</li></ul>
<h2>Forbidden</h2><ul><li>Scams, pyramid schemes, “easy money”, crypto schemes.</li><li>Drugs, weapons, documents, porn, gambling.</li><li>Enemy propaganda, insults, hate speech.</li><li>Promoting other channels and groups.</li></ul>
<h2>Deal safety</h2><ul><li>Never send prepayment to strangers.</li><li>Meet in busy places and check the item before paying.</li><li>VUS moderators never ask for money, card details or SMS codes.</li><li>Suspicious ad? Tap “🚩 Report” on the ad page.</li></ul>
<h2>Violations</h2><p>Warning → a few hours’ mute → permanent ban. Scammers are banned at once.</p>`,
  },
  privacy: {
    ua: `<h1>Конфіденційність</h1><p>Коротко: ми збираємо лише те, без чого сайт не працює, і нікому це не продаємо.</p>
<h2>Що ми отримуємо</h2><ul><li><b>Під час входу через Telegram:</b> ваш Telegram ID, ім’я, нік і фото профілю. Пароля та номера телефону Telegram нам не передає.</li><li><b>В оголошенні:</b> текст, фото, місто і контакт, який ви самі вказали (нік і/або телефон).</li><li><b>Статистика:</b> кількість переглядів оголошень і натискань «Показати контакт» — без прив’язки до конкретних відвідувачів.</li></ul>
<h2>Навіщо</h2><ul><li>Щоб показати ваше оголошення, перевірити, що ви учасник спільноти, і надіслати відповідь модератора в Telegram.</li><li>Щоб захищати спільноту від спаму та шахраїв.</li></ul>
<h2>Чого ми не робимо</h2><ul><li>Не продаємо й не передаємо ваші дані третім особам.</li><li>Не показуємо сторонню рекламу і не використовуємо рекламні трекери.</li></ul>
<h2>Cookies</h2><p>Лише файл cookie входу (30 днів) і вибрана мова. Вибране місто зберігається у вашому браузері.</p>
<h2>Ваші права</h2><p>Видалити оголошення можна в «Мій кабінет». Щоб видалити всі свої дані, надішліть боту команду /deletedata або напишіть через «💡 Ідея або відгук».</p>
<h2>Де зберігаються дані</h2><p>На серверах Cloudflare. Власник проєкту: Олександр, Бухарест, Румунія.</p>`,
    ru: `<h1>Конфиденциальность</h1><p>Коротко: мы собираем только то, без чего сайт не работает, и никому это не продаём.</p>
<h2>Что мы получаем</h2><ul><li><b>При входе через Telegram:</b> ваш Telegram ID, имя, ник и фото профиля. Пароль и номер телефона Telegram нам не передаёт.</li><li><b>В объявлении:</b> текст, фото, город и контакт, который вы сами указали.</li><li><b>Статистика:</b> число просмотров объявлений и нажатий «Показать контакт» — без привязки к посетителям.</li></ul>
<h2>Зачем</h2><ul><li>Чтобы показать ваше объявление, проверить, что вы участник сообщества, и отправить ответ модератора в Telegram.</li><li>Чтобы защищать сообщество от спама и мошенников.</li></ul>
<h2>Чего мы не делаем</h2><ul><li>Не продаём и не передаём ваши данные третьим лицам.</li><li>Не показываем стороннюю рекламу и не используем рекламные трекеры.</li></ul>
<h2>Cookies</h2><p>Только cookie входа (30 дней) и выбранный язык. Выбранный город хранится в вашем браузере.</p>
<h2>Ваши права</h2><p>Удалить объявление можно в «Мой кабинет». Чтобы удалить все свои данные, отправьте боту команду /deletedata.</p>
<h2>Где хранятся данные</h2><p>На серверах Cloudflare. Владелец проекта: Олександр, Бухарест, Румыния.</p>`,
    en: `<h1>Privacy</h1><p>In short: we collect only what the site needs to work, and we never sell it.</p>
<h2>What we receive</h2><ul><li><b>When you log in with Telegram:</b> your Telegram ID, name, username and profile photo. Telegram does not share your password or phone number.</li><li><b>In an ad:</b> the text, photos, city and the contact you chose to show.</li><li><b>Statistics:</b> ad views and “Show contact” clicks — not linked to individual visitors.</li></ul>
<h2>Why</h2><ul><li>To show your ad, check that you are a community member and send you the moderator’s answer in Telegram.</li><li>To protect the community from spam and scams.</li></ul>
<h2>What we don’t do</h2><ul><li>We don’t sell or share your data with third parties.</li><li>No third-party ads, no ad trackers.</li></ul>
<h2>Cookies</h2><p>Only the login cookie (30 days) and your language. Your chosen city is stored in your browser.</p>
<h2>Your rights</h2><p>Delete an ad in “My account”. To delete all your data, send /deletedata to the bot.</p>
<h2>Where data is stored</h2><p>On Cloudflare servers. Project owner: Oleksandr, Bucharest, Romania.</p>`,
  },
};
