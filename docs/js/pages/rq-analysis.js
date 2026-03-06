window.renderRQ = function(container, data) {
  if (!data.has_results) {
    container.innerHTML = '<div class="no-results-container">' +
      '<div class="no-results-icon">' + lucideIcon('loader', {size:'4rem', color:'var(--text-muted)'}) + '</div>' +
      '<div class="no-results-text">' + t('no_results') + '</div>' +
      '<div class="no-results-sub">' + t('no_results_sub') + '</div></div>';
    return;
  }

  var html = '<div class="tabs-row">';
  html += '<button class="tab-btn active" data-rq="rq1">' + t('rq1_title') + '</button>';
  html += '<button class="tab-btn" data-rq="rq2">' + t('rq2_title') + '</button>';
  html += '<button class="tab-btn" data-rq="rq3">' + t('rq3_title') + '</button>';
  html += '</div>';
  html += '<div id="rq-content"></div>';

  container.innerHTML = html;

  container.querySelectorAll('.tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      container.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
      this.classList.add('active');
      renderRQTab(this.getAttribute('data-rq'), data);
    });
  });

  renderRQTab('rq1', data);
};

function renderRQTab(rq, data) {
  var el = document.getElementById('rq-content');
  if (rq === 'rq1') renderRQ1(el, data);
  else if (rq === 'rq2') renderRQ2(el, data);
  else renderRQ3(el, data);
}

function renderRQ1(el, data) {
  var html = '<div class="section"><p style="color:var(--text-muted);margin-bottom:1.5rem">' + t('rq1_desc') + '</p>';
  html += '<div class="card-grid card-grid-2">';
  html += '<div class="card"><div id="rq1-radar" class="chart-container-lg"></div></div>';
  html += '<div class="card"><div id="rq1-summary" class="chart-container-lg"></div></div>';
  html += '</div></div>';
  el.innerHTML = html;

  var models = data.metadata.models;
  var modelColors = getModelColors(models.length);

  var s1metrics = ['mrr', 'any_hit@1', 'recall@1'];
  var s2metrics = ['mrr', 'any_overlap@1', 'recall@1'];
  var allMetrics = [];
  s1metrics.forEach(function(m) { allMetrics.push({key: m, stage: 'stage1', label: 'S1:' + m}); });
  s2metrics.forEach(function(m) { allMetrics.push({key: m, stage: 'stage2', label: 'S2:' + m}); });

  var radarIndicator = allMetrics.map(function(m) { return { name: m.label, max: 1 }; });
  var radarData = models.map(function(model, mi) {
    var sanitized = model.replace(/:/g, '-').replace(/\//g, '-');
    var vals = allMetrics.map(function(metric) {
      var total = 0, count = 0;
      data.bugs.forEach(function(bug) {
        var mm = bug.metrics[sanitized] || bug.metrics[model] || {};
        Object.keys(mm).forEach(function(cond) {
          if (cond.startsWith(metric.stage) && mm[cond][metric.key] !== undefined) {
            total += mm[cond][metric.key];
            count++;
          }
        });
      });
      return count > 0 ? Math.round(total / count * 1000) / 1000 : 0;
    });
    return { name: model, value: vals, lineStyle: { color: modelColors[mi] }, itemStyle: { color: modelColors[mi] }, areaStyle: { color: modelColors[mi] + '20' } };
  });

  var radarChart = echarts.init(document.getElementById('rq1-radar'));
  radarChart.setOption({
    backgroundColor: 'transparent',
    title: { text: 'Stage 1 + Stage 2 Metrics', left: 'center', textStyle: { color: '#c9d1d9', fontSize: 13 } },
    legend: { bottom: 0, textStyle: { color: '#c9d1d9' } },
    radar: { indicator: radarIndicator, shape: 'circle', radius: '60%', axisName: { color: '#c9d1d9', fontSize: 10 }, splitLine: { lineStyle: { color: '#30363d' } }, splitArea: { areaStyle: { color: ['transparent'] } } },
    series: [{ type: 'radar', data: radarData }]
  });

  var summaryChart = echarts.init(document.getElementById('rq1-summary'));
  var conditions = data.metadata.conditions;
  var barSeries = models.map(function(model, mi) {
    var sanitized = model.replace(/:/g, '-').replace(/\//g, '-');
    return {
      name: model, type: 'bar',
      data: conditions.map(function(cond) {
        var total = 0, count = 0;
        data.bugs.forEach(function(bug) {
          var mm = bug.metrics[sanitized] || bug.metrics[model] || {};
          if (mm[cond] && mm[cond].mrr !== undefined) { total += mm[cond].mrr; count++; }
        });
        return count > 0 ? Math.round(total / count * 1000) / 1000 : 0;
      }),
      itemStyle: { color: modelColors[mi] }
    };
  });
  summaryChart.setOption({
    backgroundColor: 'transparent',
    title: { text: 'MRR by Condition', left: 'center', textStyle: { color: '#c9d1d9', fontSize: 13 } },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { bottom: 0, textStyle: { color: '#c9d1d9' } },
    grid: { left: '10%', right: '5%', top: '15%', bottom: '15%' },
    xAxis: { type: 'category', data: conditions, axisLabel: { color: '#c9d1d9', rotate: 30, fontSize: 11 } },
    yAxis: { type: 'value', min: 0, max: 1, axisLabel: { color: '#8b949e' }, splitLine: { lineStyle: { color: '#30363d' } } },
    series: barSeries
  });

  window.addEventListener('resize', function() { radarChart.resize(); summaryChart.resize(); });
}

function renderRQ2(el, data) {
  var html = '<div class="section"><p style="color:var(--text-muted);margin-bottom:1.5rem">' + t('rq2_desc') + '</p>';
  html += '<div class="card-grid card-grid-2">';
  html += '<div class="card"><div id="rq2-s1" class="chart-container-lg"></div></div>';
  html += '<div class="card"><div id="rq2-s2" class="chart-container-lg"></div></div>';
  html += '</div></div>';
  el.innerHTML = html;

  var models = data.metadata.models;
  var modelColors = getModelColors(models.length);
  var levels = ['L1', 'L2', 'L3'];

  ['stage1', 'stage2'].forEach(function(stage, si) {
    var metricKey = stage === 'stage1' ? 'mrr' : 'mrr';
    var series = models.map(function(model, mi) {
      var sanitized = model.replace(/:/g, '-').replace(/\//g, '-');
      return {
        name: model, type: 'line',
        data: levels.map(function(l) {
          var cond = stage + '_' + l;
          var total = 0, count = 0;
          data.bugs.forEach(function(bug) {
            var mm = bug.metrics[sanitized] || bug.metrics[model] || {};
            if (mm[cond] && mm[cond][metricKey] !== undefined) { total += mm[cond][metricKey]; count++; }
          });
          return count > 0 ? Math.round(total / count * 1000) / 1000 : 0;
        }),
        lineStyle: { color: modelColors[mi], width: 3 },
        itemStyle: { color: modelColors[mi] },
        symbol: 'circle', symbolSize: 10,
        label: { show: true, color: '#e6edf3', fontSize: 11, formatter: '{c}' }
      };
    });

    var chart = echarts.init(document.getElementById(si === 0 ? 'rq2-s1' : 'rq2-s2'));
    chart.setOption({
      backgroundColor: 'transparent',
      title: { text: stage.toUpperCase() + ' — ' + metricKey + ' by Level', left: 'center', textStyle: { color: '#c9d1d9', fontSize: 13 } },
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0, textStyle: { color: '#c9d1d9' } },
      grid: { left: '10%', right: '5%', top: '15%', bottom: '15%' },
      xAxis: { type: 'category', data: levels, axisLabel: { color: '#c9d1d9', fontSize: 13 } },
      yAxis: { type: 'value', min: 0, max: 1, axisLabel: { color: '#8b949e' }, splitLine: { lineStyle: { color: '#30363d' } } },
      series: series
    });
    window.addEventListener('resize', function() { chart.resize(); });
  });
}

function renderRQ3(el, data) {
  var html = '<div class="section"><p style="color:var(--text-muted);margin-bottom:1.5rem">' + t('rq3_desc') + '</p>';
  html += '<div class="card-grid card-grid-3">';
  html += '<div class="card"><div id="rq3-type" class="chart-container-lg"></div></div>';
  html += '<div class="card"><div id="rq3-complexity" class="chart-container-lg"></div></div>';
  html += '<div class="card"><div id="rq3-leakage" class="chart-container-lg"></div></div>';
  html += '</div></div>';
  el.innerHTML = html;

  var models = data.metadata.models;
  var modelColors = getModelColors(models.length);

  renderGroupHeatmap('rq3-type', data, 'bug_type', data.metadata.bug_types, tType, models, modelColors);
  renderGroupHeatmap('rq3-complexity', data, 'complexity', data.metadata.complexities, tComplexity, models, modelColors);
  renderGroupHeatmap('rq3-leakage', data, 'leakage_level', data.metadata.leakage_levels, tLeakage, models, modelColors);
}

function renderGroupHeatmap(chartId, data, groupKey, groupValues, labelFn, models, modelColors) {
  var hmData = [];

  models.forEach(function(model, yi) {
    var sanitized = model.replace(/:/g, '-').replace(/\//g, '-');
    groupValues.forEach(function(gv, xi) {
      var total = 0, count = 0;
      data.bugs.forEach(function(bug) {
        var bugGroupVal;
        if (groupKey === 'leakage_level') {
          bugGroupVal = (bug.leakage && bug.leakage.leakage_level) || 'NONE';
        } else {
          bugGroupVal = bug[groupKey];
        }
        if (bugGroupVal !== gv) return;
        var mm = bug.metrics[sanitized] || bug.metrics[model] || {};
        Object.values(mm).forEach(function(m) {
          if (m.mrr !== undefined) { total += m.mrr; count++; }
        });
      });
      var avg = count > 0 ? Math.round(total / count * 1000) / 1000 : 0;
      hmData.push([xi, yi, avg]);
    });
  });

  var chart = echarts.init(document.getElementById(chartId));
  chart.setOption({
    backgroundColor: 'transparent',
    tooltip: { formatter: function(p) { return labelFn(groupValues[p.data[0]]) + ' | ' + models[p.data[1]] + '<br>Avg MRR: ' + p.data[2]; } },
    grid: { left: '25%', right: '8%', top: '5%', bottom: '15%' },
    xAxis: { type: 'category', data: groupValues.map(labelFn), axisLabel: { color: '#c9d1d9', fontSize: 10, rotate: groupValues.length > 4 ? 30 : 0 } },
    yAxis: { type: 'category', data: models, axisLabel: { color: '#c9d1d9', fontSize: 10 } },
    visualMap: { min: 0, max: 1, calculable: false, orient: 'horizontal', left: 'center', bottom: '0%', inRange: { color: ['#da3633', '#d29922', '#7ee787', '#2ea043'] }, textStyle: { color: '#8b949e' }, itemWidth: 15, itemHeight: 80 },
    series: [{ type: 'heatmap', data: hmData, label: { show: true, color: '#e6edf3', fontSize: 11, fontWeight: 'bold' } }]
  });
  window.addEventListener('resize', function() { chart.resize(); });
}
