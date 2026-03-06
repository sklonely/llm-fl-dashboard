window.renderOverview = function(container, data) {
  var exp = data.experiment;
  var models = exp.models;
  var modelNames = Object.keys(models);
  var ollama = exp.ollama || {};
  var ctxLevels = exp.context_levels || {};

  var html = '';

  html += '<div class="section">';
  html += '<h2 class="section-title">' + t('overview_flow_title') + '</h2>';
  html += '<div class="flow-container">';
  html += '<div class="flow-step"><div class="flow-icon">' + lucideIcon('bug', {size:'1.5rem', color:'var(--accent-orange)'}) + '</div>';
  html += '<div class="flow-label">' + t('overview_flow_bug') + '</div></div>';
  html += '<div class="flow-arrow">' + lucideIcon('arrow-right', {size:'1.5rem', color:'var(--accent)'}) + '</div>';
  html += '<div class="flow-step"><div class="flow-icon">' + lucideIcon('folder-search', {size:'1.5rem', color:'var(--accent)'}) + '</div>';
  html += '<div class="flow-label">' + t('overview_flow_stage1') + '</div>';
  html += '<div class="flow-desc">' + t('overview_flow_stage1_desc') + '</div></div>';
  html += '<div class="flow-arrow">' + lucideIcon('arrow-right', {size:'1.5rem', color:'var(--accent)'}) + '</div>';
  html += '<div class="flow-step"><div class="flow-icon">' + lucideIcon('map-pin', {size:'1.5rem', color:'var(--accent-green)'}) + '</div>';
  html += '<div class="flow-label">' + t('overview_flow_stage2') + '</div>';
  html += '<div class="flow-desc">' + t('overview_flow_stage2_desc') + '</div></div>';
  html += '</div></div>';

  html += '<div class="section">';
  html += '<h2 class="section-title">' + t('overview_models') + '</h2>';
  html += '<div class="card-grid card-grid-' + Math.min(modelNames.length, 4) + '">';
  for (var i = 0; i < modelNames.length; i++) {
    var name = modelNames[i];
    var m = models[name];
    html += '<div class="card model-card model-' + i + '">';
    html += '<div class="model-name">' + name + '</div>';
    html += '<div class="model-detail"><span class="label">Developer</span><span class="value">' + (m.developer || '') + '</span></div>';
    html += '<div class="model-detail"><span class="label">Parameters</span><span class="value">' + (m.params || '') + '</span></div>';
    html += '<div class="model-detail"><span class="label">Cutoff</span><span class="value">' + (m.knowledge_cutoff || '') + '</span></div>';
    html += '<div class="model-detail"><span class="label">Quantization</span><span class="value">' + (m.quantization || 'Q4_K_M') + '</span></div>';
    html += '<div class="model-detail"><span class="label">Max Context</span><span class="value">' + ((m.max_context || 0) / 1024).toFixed(0) + 'K</span></div>';
    html += '</div>';
  }
  html += '</div></div>';

  html += '<div class="section">';
  html += '<h2 class="section-title">' + t('overview_context_levels') + '</h2>';
  html += '<div class="card"><table class="ctx-table"><thead><tr>';
  html += '<th></th><th><span class="level-badge level-L1">L1</span></th>';
  html += '<th><span class="level-badge level-L2">L2</span></th>';
  html += '<th><span class="level-badge level-L3">L3</span></th></tr></thead><tbody>';
  var stageLabels = { stage1: 'Stage 1 — ' + t('overview_flow_stage1'), stage2: 'Stage 2 — ' + t('overview_flow_stage2') };
  ['stage1', 'stage2'].forEach(function(s) {
    var levels = ctxLevels[s] || {};
    html += '<tr><td><strong>' + stageLabels[s] + '</strong></td>';
    html += '<td>' + (levels.L1 || '') + '</td>';
    html += '<td>' + (levels.L2 || '') + '</td>';
    html += '<td>' + (levels.L3 || '') + '</td></tr>';
  });
  html += '</tbody></table></div></div>';

  html += '<div class="section">';
  html += '<h2 class="section-title">' + t('overview_funnel') + '</h2>';
  html += '<div class="card">';
  html += '<div class="funnel">';
  var funnelSteps = [
    { key: 'funnel_step1', count: '1,888', width: 100, color: 'var(--accent)' },
    { key: 'funnel_step2', count: '~1,200', width: 80, color: 'var(--accent-purple)' },
    { key: 'funnel_step3', count: '~380', width: 60, color: 'var(--accent-orange)' },
    { key: 'funnel_step4', count: '~55', width: 45, color: 'var(--accent-yellow)' },
    { key: 'funnel_step5', count: '50', width: 35, color: 'var(--accent-green)' }
  ];
  funnelSteps.forEach(function(step, idx) {
    if (idx > 0) html += '<div class="funnel-arrow">▼</div>';
    html += '<div class="funnel-step" style="width:' + step.width + '%;background:' + step.color + '15;border:1px solid ' + step.color + '40">';
    html += t(step.key) + '<span class="funnel-count" style="color:' + step.color + '">' + step.count + '</span></div>';
  });
  html += '</div></div></div>';

  html += '<div class="section">';
  html += '<h2 class="section-title">' + t('overview_params') + '</h2>';
  html += '<div class="card"><div class="param-grid">';
  var params = [
    { key: 'param_temperature', val: ollama.temperature != null ? ollama.temperature : 0 },
    { key: 'param_seed', val: ollama.seed || 42 },
    { key: 'param_num_ctx', val: ((ollama.num_ctx || 131072) / 1024) + 'K' },
    { key: 'param_max_tokens', val: ollama.max_tokens || 512 },
    { key: 'param_think', val: 'false' },
    { key: 'param_top_k', val: 5 }
  ];
  params.forEach(function(p) {
    html += '<div class="param-item"><span class="param-key">' + t(p.key) + '</span>';
    html += '<span class="param-val">' + p.val + '</span></div>';
  });
  html += '</div></div></div>';

  html += '<div class="section">';
  html += '<h2 class="section-title">' + t('overview_total_calls') + '</h2>';
  html += '<div class="card stat-card">';
  var totalCalls = exp.total_calls ? exp.total_calls.count : (modelNames.length * 2 * 3 * (exp.data ? exp.data.max_bugs : 50));
  html += '<div class="stat-value">' + totalCalls.toLocaleString() + '</div>';
  html += '<div class="stat-label">' + (exp.total_calls ? exp.total_calls.formula : (modelNames.length + ' ' + t('model') + ' × 2 ' + t('stage') + ' × 3 ' + t('level') + ' × 50 bugs')) + '</div>';
  html += '</div></div>';

  container.innerHTML = html;
};
