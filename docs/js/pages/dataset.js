window.renderDataset = function(container, data) {
  var bugs = data.bugs;
  var meta = data.metadata;

  var avgLines = Math.round(bugs.reduce(function(s, b) { return s + (b.ground_truth.total_modified_lines || 0); }, 0) / bugs.length);
  var repoCount = meta.repos.length;

  var html = '';

  html += '<div class="section"><div class="card-grid card-grid-4">';
  var stats = [
    { label: t('dataset_total_bugs'), value: bugs.length },
    { label: t('dataset_repos'), value: repoCount },
    { label: t('dataset_avg_lines'), value: avgLines },
    { label: t('dataset_types'), value: meta.bug_types.length }
  ];
  stats.forEach(function(s) {
    html += '<div class="card stat-card"><div class="stat-value">' + s.value + '</div>';
    html += '<div class="stat-label">' + s.label + '</div></div>';
  });
  html += '</div></div>';

  html += '<div class="section"><h2 class="section-title">' + t('dataset_distribution') + '</h2>';
  html += '<div class="card-grid card-grid-3">';
  html += '<div class="card"><div id="chart-bug-type" class="chart-container-sm"></div></div>';
  html += '<div class="card"><div id="chart-complexity" class="chart-container-sm"></div></div>';
  html += '<div class="card"><div id="chart-leakage" class="chart-container-sm"></div></div>';
  html += '</div></div>';

  html += '<div class="section"><h2 class="section-title">' + t('dataset_cross_tab') + '</h2>';
  html += '<div class="card"><div id="chart-heatmap" class="chart-container"></div></div></div>';

  html += '<div class="section"><h2 class="section-title">' + t('dataset_repo_dist') + '</h2>';
  html += '<div class="card"><div id="chart-repos" class="chart-container-lg"></div></div></div>';

  html += '<div class="section"><h2 class="section-title">' + t('dataset_table') + '</h2>';
  html += '<div class="card">';
  html += '<div class="table-controls">';
  html += '<select id="filter-type"><option value="">' + t('bug_type') + ': ' + t('dataset_filter_all') + '</option>';
  meta.bug_types.forEach(function(bt) { html += '<option value="' + bt + '">' + tType(bt) + '</option>'; });
  html += '</select>';
  html += '<select id="filter-complexity"><option value="">' + t('complexity') + ': ' + t('dataset_filter_all') + '</option>';
  meta.complexities.forEach(function(c) { html += '<option value="' + c + '">' + tComplexity(c) + '</option>'; });
  html += '</select>';
  html += '<select id="filter-leakage"><option value="">' + t('leakage') + ': ' + t('dataset_filter_all') + '</option>';
  meta.leakage_levels.forEach(function(l) { html += '<option value="' + l + '">' + tLeakage(l) + '</option>'; });
  html += '</select>';
  html += '</div>';
  html += '<div style="overflow-x:auto"><table class="data-table"><thead><tr>';
  html += '<th data-sort="instance_id">' + t('instance_id') + '</th>';
  html += '<th data-sort="repo">' + t('repo') + '</th>';
  html += '<th data-sort="bug_type">' + t('bug_type') + '</th>';
  html += '<th data-sort="complexity">' + t('complexity') + '</th>';
  html += '<th data-sort="leakage">' + t('leakage') + '</th>';
  html += '<th data-sort="gt_lines">' + t('gt_lines') + '</th>';
  html += '</tr></thead><tbody id="bug-table-body"></tbody></table></div>';
  html += '</div></div>';

  container.innerHTML = html;

  initDatasetCharts(bugs, meta);
  renderBugTable(bugs);
  bindTableControls(bugs);
};

function initDatasetCharts(bugs, meta) {
  var typeColors = {
    API_TYPE: '#bc8cff', CONFIG: '#e3b341', LOGIC: '#58a6ff',
    MISSING_CHECK: '#f78166', MISSING_HANDLER: '#7ee787'
  };

  var typeCounts = {};
  meta.bug_types.forEach(function(bt) { typeCounts[bt] = 0; });
  bugs.forEach(function(b) { typeCounts[b.bug_type] = (typeCounts[b.bug_type] || 0) + 1; });

  var typeChart = echarts.init(document.getElementById('chart-bug-type'));
  typeChart.setOption({
    backgroundColor: 'transparent',
    title: { text: t('bug_type'), left: 'center', textStyle: { color: '#c9d1d9', fontSize: 13 } },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: '3%', right: '10%', bottom: '3%', top: '15%', containLabel: true },
    xAxis: { type: 'value', axisLabel: { color: '#8b949e' }, splitLine: { lineStyle: { color: '#30363d' } } },
    yAxis: {
      type: 'category',
      data: meta.bug_types.map(function(bt) { return tType(bt); }),
      axisLabel: { color: '#c9d1d9', fontSize: 11 }
    },
    series: [{
      type: 'bar',
      data: meta.bug_types.map(function(bt) { return { value: typeCounts[bt], itemStyle: { color: typeColors[bt] } }; }),
      barWidth: '50%'
    }]
  });

  var complexityCounts = { S: 0, M: 0, C: 0 };
  bugs.forEach(function(b) { complexityCounts[b.complexity] = (complexityCounts[b.complexity] || 0) + 1; });
  var compColors = { S: '#7ee787', M: '#e3b341', C: '#f78166' };

  var compChart = echarts.init(document.getElementById('chart-complexity'));
  compChart.setOption({
    backgroundColor: 'transparent',
    title: { text: t('complexity'), left: 'center', textStyle: { color: '#c9d1d9', fontSize: 13 } },
    tooltip: { trigger: 'item' },
    series: [{
      type: 'pie',
      radius: ['40%', '70%'],
      center: ['50%', '55%'],
      label: { color: '#c9d1d9', formatter: '{b}: {c}' },
      data: ['S', 'M', 'C'].map(function(c) {
        return { name: tComplexity(c), value: complexityCounts[c], itemStyle: { color: compColors[c] } };
      })
    }]
  });

  var leakCounts = { HIGH: 0, MEDIUM: 0, LOW: 0, NONE: 0 };
  bugs.forEach(function(b) {
    var lv = (b.leakage && b.leakage.leakage_level) || 'NONE';
    leakCounts[lv] = (leakCounts[lv] || 0) + 1;
  });
  var leakColors = { HIGH: '#f78166', MEDIUM: '#e3b341', LOW: '#58a6ff', NONE: '#7ee787' };

  var leakChart = echarts.init(document.getElementById('chart-leakage'));
  leakChart.setOption({
    backgroundColor: 'transparent',
    title: { text: t('leakage'), left: 'center', textStyle: { color: '#c9d1d9', fontSize: 13 } },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: '3%', right: '10%', bottom: '3%', top: '15%', containLabel: true },
    xAxis: { type: 'category', data: ['HIGH', 'MEDIUM', 'LOW', 'NONE'].map(tLeakage), axisLabel: { color: '#c9d1d9' } },
    yAxis: { type: 'value', axisLabel: { color: '#8b949e' }, splitLine: { lineStyle: { color: '#30363d' } } },
    series: [{
      type: 'bar',
      data: ['HIGH', 'MEDIUM', 'LOW', 'NONE'].map(function(l) {
        return { value: leakCounts[l], itemStyle: { color: leakColors[l] } };
      }),
      barWidth: '50%'
    }]
  });

  var heatmapData = [];
  var compLabels = ['S', 'M', 'C'];
  meta.bug_types.forEach(function(bt, yi) {
    compLabels.forEach(function(c, xi) {
      var count = bugs.filter(function(b) { return b.bug_type === bt && b.complexity === c; }).length;
      heatmapData.push([xi, yi, count]);
    });
  });

  var hmChart = echarts.init(document.getElementById('chart-heatmap'));
  hmChart.setOption({
    backgroundColor: 'transparent',
    tooltip: { formatter: function(p) { return p.data[2] + ' bugs'; } },
    grid: { left: '15%', right: '15%', top: '5%', bottom: '10%' },
    xAxis: { type: 'category', data: compLabels.map(tComplexity), axisLabel: { color: '#c9d1d9' }, splitArea: { show: true, areaStyle: { color: ['rgba(255,255,255,0.02)', 'rgba(255,255,255,0.04)'] } } },
    yAxis: { type: 'category', data: meta.bug_types.map(tType), axisLabel: { color: '#c9d1d9', fontSize: 11 } },
    visualMap: { min: 0, max: 10, calculable: true, orient: 'horizontal', left: 'center', bottom: '0%', inRange: { color: ['#161b22', '#58a6ff'] }, textStyle: { color: '#8b949e' } },
    series: [{
      type: 'heatmap',
      data: heatmapData,
      label: { show: true, color: '#e6edf3', fontSize: 14, fontWeight: 'bold' },
      emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' } }
    }]
  });

  var repoCounts = {};
  bugs.forEach(function(b) { repoCounts[b.repo] = (repoCounts[b.repo] || 0) + 1; });
  var repoEntries = Object.keys(repoCounts).map(function(r) { return { name: r, count: repoCounts[r] }; })
    .sort(function(a, b) { return a.count - b.count; });

  var repoChart = echarts.init(document.getElementById('chart-repos'));
  repoChart.setOption({
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: '25%', right: '10%', top: '3%', bottom: '3%' },
    xAxis: { type: 'value', axisLabel: { color: '#8b949e' }, splitLine: { lineStyle: { color: '#30363d' } } },
    yAxis: { type: 'category', data: repoEntries.map(function(r) { return r.name; }), axisLabel: { color: '#c9d1d9', fontSize: 11 } },
    series: [{ type: 'bar', data: repoEntries.map(function(r) { return r.count; }), barWidth: '60%', itemStyle: { color: '#58a6ff' } }]
  });

  window.addEventListener('resize', function() {
    [typeChart, compChart, leakChart, hmChart, repoChart].forEach(function(c) { c.resize(); });
  });
}

function renderBugTable(bugs, sortKey, sortDir) {
  sortKey = sortKey || 'instance_id';
  sortDir = sortDir || 'asc';

  var sorted = bugs.slice().sort(function(a, b) {
    var va, vb;
    if (sortKey === 'gt_lines') {
      va = a.ground_truth.total_modified_lines;
      vb = b.ground_truth.total_modified_lines;
    } else if (sortKey === 'leakage') {
      var order = { HIGH: 0, MEDIUM: 1, LOW: 2, NONE: 3 };
      va = order[(a.leakage && a.leakage.leakage_level) || 'NONE'];
      vb = order[(b.leakage && b.leakage.leakage_level) || 'NONE'];
    } else {
      va = a[sortKey] || '';
      vb = b[sortKey] || '';
    }
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  var tbody = document.getElementById('bug-table-body');
  if (!tbody) return;
  var html = '';
  sorted.forEach(function(b) {
    var leak = (b.leakage && b.leakage.leakage_level) || 'NONE';
    html += '<tr data-id="' + b.instance_id + '">';
    html += '<td style="font-family:monospace;font-size:0.75rem">' + b.instance_id + '</td>';
    html += '<td>' + b.repo + '</td>';
    html += '<td><span class="badge badge-type">' + tType(b.bug_type) + '</span></td>';
    html += '<td><span class="badge badge-complexity-' + b.complexity + '">' + tComplexity(b.complexity) + '</span></td>';
    html += '<td><span class="badge badge-leakage-' + leak + '">' + tLeakage(leak) + '</span></td>';
    html += '<td>' + b.ground_truth.total_modified_lines + '</td>';
    html += '</tr>';
  });
  tbody.innerHTML = html;

  tbody.querySelectorAll('tr').forEach(function(row) {
    row.addEventListener('click', function() {
      var id = this.getAttribute('data-id');
      var existing = this.nextElementSibling;
      if (existing && existing.classList.contains('expand-row')) {
        existing.remove();
        return;
      }
      var bug = bugs.find(function(b) { return b.instance_id === id; });
      if (!bug) return;
      var expandTr = document.createElement('tr');
      expandTr.className = 'expand-row';
      var ps = (bug.context.problem_statement || '').substring(0, 800);
      var reasoning = bug.classification_reasoning || '';
      var gtFiles = bug.ground_truth.files.join(', ');
      expandTr.innerHTML = '<td colspan="6">' +
        '<strong>' + t('inspector_ps') + ':</strong><br>' + escapeHtml(ps) +
        (ps.length >= 800 ? '...' : '') +
        '<br><br><strong>' + t('reasoning') + ':</strong><br>' + escapeHtml(reasoning) +
        '<br><br><strong>' + t('gt_files') + ':</strong> ' + escapeHtml(gtFiles) +
        '</td>';
      this.after(expandTr);
    });
  });
}

function bindTableControls(bugs) {
  var currentSort = { key: 'instance_id', dir: 'asc' };

  document.querySelectorAll('.data-table th[data-sort]').forEach(function(th) {
    th.addEventListener('click', function() {
      var key = this.getAttribute('data-sort');
      if (currentSort.key === key) {
        currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        currentSort.key = key;
        currentSort.dir = 'asc';
      }
      renderBugTable(getFilteredBugs(bugs), currentSort.key, currentSort.dir);
    });
  });

  ['filter-type', 'filter-complexity', 'filter-leakage'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('change', function() {
      renderBugTable(getFilteredBugs(bugs), currentSort.key, currentSort.dir);
    });
  });
}

function getFilteredBugs(bugs) {
  var ft = (document.getElementById('filter-type') || {}).value || '';
  var fc = (document.getElementById('filter-complexity') || {}).value || '';
  var fl = (document.getElementById('filter-leakage') || {}).value || '';
  return bugs.filter(function(b) {
    if (ft && b.bug_type !== ft) return false;
    if (fc && b.complexity !== fc) return false;
    if (fl && ((b.leakage && b.leakage.leakage_level) || 'NONE') !== fl) return false;
    return true;
  });
}

function escapeHtml(str) {
  var div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}
