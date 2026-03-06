window.renderResults = function(container, data) {
  if (!data.has_results) {
    container.innerHTML = renderNoResults();
    return;
  }

  var meta = data.metadata;
  var agg = data.aggregated || {};

  var html = '';

  html += '<div class="section">';
  html += '<h2 class="section-title">' + t('results_heatmap') + '</h2>';
  html += '<select class="metric-select" id="heatmap-metric">';
  html += '<option value="mrr">MRR</option>';
  html += '<option value="any_hit@1">Hit@1</option>';
  html += '<option value="recall@1">Recall@1</option>';
  html += '<option value="top1_accuracy">Top1 Accuracy</option>';
  html += '</select>';
  html += '<div class="card"><div id="chart-main-heatmap" class="chart-container-lg"></div></div>';
  html += '</div>';

  html += '<div class="section">';
  html += '<h2 class="section-title">' + t('results_comparison') + '</h2>';
  html += '<div class="card-grid card-grid-2">';
  html += '<div class="card"><div id="chart-stage1-trend" class="chart-container"></div></div>';
  html += '<div class="card"><div id="chart-stage2-trend" class="chart-container"></div></div>';
  html += '</div></div>';

  html += '<div class="section">';
  html += '<h2 class="section-title">' + t('results_timing') + '</h2>';
  html += '<div class="card"><div id="chart-timing" class="chart-container"></div></div>';
  html += '</div>';

  html += '<div class="section">';
  html += '<h2 class="section-title">' + t('results_parse') + '</h2>';
  html += '<div class="card-grid card-grid-' + Math.min(data.metadata.models.length, 4) + '" id="parse-stats"></div>';
  html += '</div>';

  container.innerHTML = html;

  renderMainHeatmap(data, 'mrr');
  renderTrendCharts(data);
  renderTimingChart(data);
  renderParseStats(data);

  document.getElementById('heatmap-metric').addEventListener('change', function() {
    renderMainHeatmap(data, this.value);
  });
};

function renderNoResults() {
  return '<div class="no-results-container">' +
    '<div class="no-results-icon">' + lucideIcon('loader', {size:'4rem', color:'var(--text-muted)'}) + '</div>' +
    '<div class="no-results-text">' + t('no_results') + '</div>' +
    '<div class="no-results-sub">' + t('no_results_sub') + '</div></div>';
}

function getModelConditionMetric(data, metricKey) {
  var models = data.metadata.models;
  var conditions = data.metadata.conditions;
  var bugs = data.bugs;
  var result = {};

  models.forEach(function(model) {
    result[model] = {};
    var sanitized = model.replace(/:/g, '-').replace(/\//g, '-');
    conditions.forEach(function(cond) {
      var vals = [];
      bugs.forEach(function(bug) {
        var mm = bug.metrics[sanitized] || bug.metrics[model] || {};
        var m = mm[cond];
        if (m && m[metricKey] !== undefined) vals.push(m[metricKey]);
      });
      result[model][cond] = vals.length > 0 ? vals.reduce(function(a,b){return a+b;},0) / vals.length : null;
    });
  });
  return result;
}

function renderMainHeatmap(data, metricKey) {
  var models = data.metadata.models;
  var conditions = data.metadata.conditions;
  var mcData = getModelConditionMetric(data, metricKey);

  var hmData = [];
  models.forEach(function(model, yi) {
    conditions.forEach(function(cond, xi) {
      var val = mcData[model][cond];
      hmData.push([xi, yi, val !== null ? Math.round(val * 1000) / 1000 : '-']);
    });
  });

  var chart = echarts.init(document.getElementById('chart-main-heatmap'));
  chart.setOption({
    backgroundColor: 'transparent',
    tooltip: { formatter: function(p) { return conditions[p.data[0]] + ' | ' + models[p.data[1]] + '<br>' + metricKey + ': ' + p.data[2]; } },
    grid: { left: '18%', right: '12%', top: '5%', bottom: '15%' },
    xAxis: { type: 'category', data: conditions, axisLabel: { color: '#c9d1d9', rotate: 30, fontSize: 11 }, splitArea: { show: true, areaStyle: { color: ['rgba(255,255,255,0.02)', 'rgba(255,255,255,0.04)'] } } },
    yAxis: { type: 'category', data: models, axisLabel: { color: '#c9d1d9', fontSize: 12 } },
    visualMap: { min: 0, max: 1, calculable: true, orient: 'vertical', right: '2%', top: 'center', inRange: { color: ['#da3633', '#d29922', '#7ee787', '#2ea043'] }, textStyle: { color: '#8b949e' } },
    series: [{ type: 'heatmap', data: hmData, label: { show: true, color: '#e6edf3', fontSize: 13, fontWeight: 'bold' }, emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' } } }]
  });
  window.addEventListener('resize', function() { chart.resize(); });
}

function getModelColors(count) {
  var palette = ['#58a6ff', '#f78166', '#7ee787', '#bc8cff', '#e3b341', '#f0883e'];
  return palette.slice(0, count);
}

function renderTrendCharts(data) {
  var models = data.metadata.models;
  var modelColors = getModelColors(models.length);
  var levels = ['L1', 'L2', 'L3'];

  ['stage1', 'stage2'].forEach(function(stage, si) {
    var chartId = si === 0 ? 'chart-stage1-trend' : 'chart-stage2-trend';
    var metricKey = stage === 'stage1' ? 'mrr' : 'mrr';
    var mcData = getModelConditionMetric(data, metricKey);

    var series = models.map(function(model, mi) {
      return {
        name: model,
        type: 'line',
        data: levels.map(function(l) { return mcData[model][stage + '_' + l]; }),
        lineStyle: { color: modelColors[mi], width: 2 },
        itemStyle: { color: modelColors[mi] },
        symbol: 'circle',
        symbolSize: 8
      };
    });

    var chart = echarts.init(document.getElementById(chartId));
    chart.setOption({
      backgroundColor: 'transparent',
      title: { text: stage.toUpperCase() + ' — MRR by Level', left: 'center', textStyle: { color: '#c9d1d9', fontSize: 13 } },
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0, textStyle: { color: '#c9d1d9', fontSize: 11 } },
      grid: { left: '10%', right: '5%', top: '15%', bottom: '20%' },
      xAxis: { type: 'category', data: levels, axisLabel: { color: '#c9d1d9' } },
      yAxis: { type: 'value', min: 0, max: 1, axisLabel: { color: '#8b949e' }, splitLine: { lineStyle: { color: '#30363d' } } },
      series: series
    });
    window.addEventListener('resize', function() { chart.resize(); });
  });
}

function renderTimingChart(data) {
  var models = data.metadata.models;
  var conditions = data.metadata.conditions;
  var modelColors = getModelColors(models.length);
  var bugs = data.bugs;

  var series = models.map(function(model, mi) {
    var sanitized = model.replace(/:/g, '-').replace(/\//g, '-');
    return {
      name: model,
      type: 'bar',
      data: conditions.map(function(cond) {
        var durations = [];
        bugs.forEach(function(bug) {
          var mr = bug.results[sanitized] || bug.results[model] || {};
          var r = mr[cond];
          if (r && r.duration_ms) durations.push(r.duration_ms / 1000);
        });
        return durations.length > 0 ? Math.round(durations.reduce(function(a,b){return a+b;},0) / durations.length * 10) / 10 : 0;
      }),
      itemStyle: { color: modelColors[mi] }
    };
  });

  var chart = echarts.init(document.getElementById('chart-timing'));
  chart.setOption({
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: function(ps) { return ps.map(function(p) { return p.seriesName + ': ' + (p.data === 0 ? 'N/A (Batch API)' : p.data + 's'); }).join('<br>'); } },
    legend: { bottom: 0, textStyle: { color: '#c9d1d9' } },
    grid: { left: '8%', right: '5%', top: '5%', bottom: '18%' },
    xAxis: { type: 'category', data: conditions, axisLabel: { color: '#c9d1d9', rotate: 30 } },
    yAxis: { type: 'value', name: 'Avg seconds', nameTextStyle: { color: '#8b949e' }, axisLabel: { color: '#8b949e' }, splitLine: { lineStyle: { color: '#30363d' } } },
    series: series
  });
  window.addEventListener('resize', function() { chart.resize(); });
}

function renderParseStats(data) {
  var models = data.metadata.models;
  var bugs = data.bugs;
  var el = document.getElementById('parse-stats');
  var html = '';

  models.forEach(function(model, mi) {
    var sanitized = model.replace(/:/g, '-').replace(/\//g, '-');
    var total = 0, success = 0;
    bugs.forEach(function(bug) {
      var mr = bug.results[sanitized] || bug.results[model] || {};
      Object.values(mr).forEach(function(r) {
        total++;
        if (r.parse_success) success++;
      });
    });
    var rate = total > 0 ? Math.round(success / total * 100) : 0;
    var colors = ['var(--model-1)', 'var(--model-2)', 'var(--model-3)', 'var(--model-4)', 'var(--accent-yellow)', 'var(--accent-orange)'];
    html += '<div class="card stat-card">';
    html += '<div class="stat-value" style="color:' + colors[mi] + '">' + rate + '%</div>';
    html += '<div class="stat-label">' + model + ' (' + success + '/' + total + ')</div>';
    html += '</div>';
  });

  el.innerHTML = html;
}
