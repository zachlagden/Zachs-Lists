const ICON = {
  home: '<path d="M3 9.5 10 4l7 5.5V16a1 1 0 0 1-1 1h-3.5v-4.5h-5V17H4a1 1 0 0 1-1-1z"/>',
  sliders:
    '<path d="M4 6h7M15 6h1M4 14h1M9 14h7"/><circle cx="13" cy="6" r="2"/><circle cx="7" cy="14" r="2"/>',
  bolt: '<path d="M11 2 4 11h5l-1 7 7-9h-5z"/>',
  list: '<path d="M7 5h10M7 10h10M7 15h10M3.5 5h.01M3.5 10h.01M3.5 15h.01"/>',
  shield: '<path d="M10 2.5 16 5v4.5c0 3.6-2.4 6.4-6 8-3.6-1.6-6-4.4-6-8V5z"/>',
  globe:
    '<circle cx="10" cy="10" r="7"/><path d="M3 10h14M10 3c2.5 2.6 2.5 11.400 0 14M10 3c-2.5 2.600-2.500 11.400 0 14"/>',
  menu: '<path d="M3 6h14M3 10h14M3 14h14"/>',
  theme: '<path d="M10 3a7 7 0 1 0 7 7 5 5 0 0 1-7-7z"/>',
  check: '<circle cx="10" cy="10" r="7"/><path d="m7 10 2 2 4-4.500"/>',
  warn: '<path d="M10 3 2.500 16h15z"/><path d="M10 8v4M10 14.200v.010"/>',
  x: '<circle cx="10" cy="10" r="7"/><path d="m7.500 7.500 5 5M12.500 7.500l-5 5"/>',
  loop: '<path d="M16 10a6 6 0 1 1-2-4.500"/><path d="M16 3.500V6h-2.500"/>',
  clock: '<circle cx="10" cy="10" r="7"/><path d="M10 6.500V10l2.500 1.500"/>',
  copy: '<rect x="7" y="7" width="9" height="9" rx="2"/><path d="M4 13V5a1 1 0 0 1 1-1h8"/>',
  plus: '<path d="M10 4v12M4 10h12"/>',
  dash: '<circle cx="10" cy="10" r="7"/><path d="M7 10h6"/>',
};

function icon(name, extra = '') {
  return `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.600" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="${extra}">${ICON[name]}</svg>`;
}

function pill(kind, name, text, spinning = false) {
  return `<span class="pill ${kind}">${icon(name, spinning ? 'spin' : '')}${text}</span>`;
}

function mountShell() {
  const body = document.body;
  const current = body.dataset.page;
  const crumbs = body.dataset.crumbs || '';
  const links = [
    ['dashboard', 'Dashboard', 'home', 'dashboard.html', ''],
    ['config', 'Configuration', 'sliders', 'config.html', ''],
    ['builds', 'Builds', 'bolt', 'build.html', '1 running'],
    ['lists', 'My lists', 'list', 'dashboard.html', ''],
  ];
  const more = [
    ['admin', 'Admin', 'shield', 'dashboard.html'],
    ['public', 'Browse default lists', 'globe', 'index.html'],
  ];
  const link = ([id, label, ic, href, count]) =>
    `<a href="${href}" ${id === current ? 'aria-current="page"' : ''}>${icon(ic)}${label}${count ? `<span class="count">${count}</span>` : ''}</a>`;
  const side = document.createElement('aside');
  side.className = 'side';
  side.id = 'side';
  side.innerHTML = `
    <a class="brand" href="index.html"><span class="logo">ZL</span>Zach's Lists</a>
    <nav class="nav" aria-label="Main">
      ${links.map(link).join('')}
      <div class="nav-label">More</div>
      ${more.map(link).join('')}
    </nav>
    <div class="side-foot"><span class="avatar">A</span><div>Alex<small>alex</small></div></div>`;
  const top = document.createElement('header');
  top.className = 'top';
  top.innerHTML = `
    <button class="btn icon ghost menu-btn" id="menu" aria-controls="side" aria-expanded="false">${icon('menu')}<span class="sr">Menu</span></button>
    <div class="crumbs">${crumbs}</div>
    <span class="spacer"></span>
    <span class="live hide-sm"><span class="dot"></span>Live</span>
    <button class="btn icon ghost" id="theme">${icon('theme')}<span class="sr">Switch theme</span></button>`;
  const main = document.querySelector('.main');
  document.querySelector('.shell').prepend(side);
  main.prepend(top);
  const menu = document.getElementById('menu');
  menu.addEventListener('click', () => {
    const open = side.classList.toggle('open');
    menu.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') side.classList.remove('open');
  });
  main.addEventListener('click', (event) => {
    if (!event.target.closest('#menu')) side.classList.remove('open');
  });
}

function mountTheme() {
  const root = document.documentElement;
  const button = document.getElementById('theme');
  if (!button) return;
  button.addEventListener('click', () => {
    const dark =
      root.dataset.theme === 'dark' ||
      (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    root.dataset.theme = dark ? 'light' : 'dark';
  });
}

document.querySelectorAll('[data-icon]').forEach((node) => {
  node.insertAdjacentHTML('afterbegin', icon(node.dataset.icon, node.dataset.spin ? 'spin' : ''));
});
if (document.querySelector('.shell')) mountShell();
mountTheme();
