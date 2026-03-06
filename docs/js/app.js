window.APP_DATA = null;
window.currentPage = 'overview';

var pages = {
  overview: { render: window.renderOverview, navKey: 'nav_overview' },
  dataset:  { render: window.renderDataset,  navKey: 'nav_dataset' },
  inspector:{ render: window.renderInspector, navKey: 'nav_inspector' },
  results:  { render: window.renderResults,  navKey: 'nav_results' },
  rq:       { render: window.renderRQ,       navKey: 'nav_rq' }
};

function navigateTo(page) {
  window.currentPage = page;
  renderApp();
}

function renderApp() {
  var titleEl = document.getElementById('title');
  var subtitleEl = document.getElementById('subtitle');
  var langBtn = document.getElementById('lang-toggle');
  var nav = document.getElementById('nav-tabs');
  var main = document.getElementById('app');

  titleEl.textContent = t('title');
  subtitleEl.textContent = t('subtitle');
  langBtn.textContent = window.currentLang === 'en' ? '中文' : 'EN';

  var navHtml = '';
  Object.keys(pages).forEach(function(key) {
    var active = key === window.currentPage ? ' active' : '';
    navHtml += '<div class="nav-tab' + active + '" data-page="' + key + '">' + t(pages[key].navKey) + '</div>';
  });
  nav.innerHTML = navHtml;

  nav.querySelectorAll('.nav-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      navigateTo(this.getAttribute('data-page'));
    });
  });

  if (!window.APP_DATA) {
    main.innerHTML = '<div class="skeleton-container">' +
      '<div class="skeleton skeleton-header"></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem">' +
      '<div class="skeleton skeleton-card"></div>' +
      '<div class="skeleton skeleton-card"></div>' +
      '<div class="skeleton skeleton-card"></div></div>' +
      '<div class="skeleton skeleton-chart"></div>' +
      '<div class="skeleton skeleton-row"></div>' +
      '<div class="skeleton skeleton-row skeleton-row-medium"></div>' +
      '<div class="skeleton skeleton-row skeleton-row-short"></div></div>';
    return;
  }

  main.classList.toggle('full-width', window.currentPage === 'inspector');

  var page = pages[window.currentPage];
  if (page && page.render) {
    main.innerHTML = '';
    page.render(main, window.APP_DATA);
  } else {
    main.innerHTML = '<div class="no-results-container"><div class="no-results-icon">' + lucideIcon('construction', {size:'4rem', color:'var(--accent-yellow)'}) + '</div><div class="no-results-text">' + t('coming_soon') + '</div></div>';
  }
}

function loadData() {
  fetch('data.json')
    .then(function(resp) { return resp.json(); })
    .then(function(data) {
      window.APP_DATA = data;
      renderApp();
    })
    .catch(function(err) {
      document.getElementById('app').innerHTML =
        '<div class="no-results-container"><div class="no-results-icon">' + lucideIcon('alert-circle', {size:'4rem', color:'var(--accent-orange)'}) + '</div>' +
        '<div class="no-results-text">Failed to load data.json</div>' +
        '<div class="no-results-sub">' + err.message + '</div></div>';
    });
}

document.getElementById('lang-toggle').addEventListener('click', function() {
  window.currentLang = window.currentLang === 'en' ? 'zh' : 'en';
  renderApp();
});

renderApp();
loadData();
