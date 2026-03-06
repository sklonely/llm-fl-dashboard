window.renderInspector = function(container, data) {
  var bugs = data.bugs;
  var meta = data.metadata;
  var state = window.inspectorState || { bugIdx: 0, model: meta.models[0], stage: 'stage1', level: 'L1', search: '', filters: {} };
  window.inspectorState = state;

  var html = '<div class="inspector-master-detail">';

  html += '<div class="inspector-sidebar">';
  html += '<div class="inspector-sidebar-header">';
  html += '<div class="inspector-sidebar-title">';
  html += '<span>' + t('inspector_sidebar_title') + '</span>';
  html += '<span class="inspector-sidebar-count" id="sidebar-count"></span>';
  html += '</div>';
  html += '<div class="inspector-search-box">';
  html += '<span class="inspector-search-icon">' + lucideIcon('search', {size:'0.85rem', color:'var(--text-muted)'}) + '</span>';
  html += '<input type="text" id="bug-search" placeholder="' + t('inspector_search') + '" value="' + escapeHtml2(state.search || '') + '">';
  html += '</div>';
  html += '<div class="inspector-filters" id="filter-pills"></div>';
  html += '</div>';
  html += '<div class="inspector-bug-list" id="bug-list"></div>';
  html += '</div>';

  html += '<div class="inspector-detail" id="inspector-detail">';
  html += '<div class="inspector-detail-controls">';
  html += '<div><label>' + t('model') + '</label>';
  html += '<select id="sel-model">';
  meta.models.forEach(function(m) {
    html += '<option value="' + m + '"' + (m === state.model ? ' selected' : '') + '>' + m + '</option>';
  });
  html += '</select></div>';
  html += '<div><label>' + t('stage') + '</label>';
  html += '<select id="sel-stage">';
  ['stage1', 'stage2'].forEach(function(s) {
    html += '<option value="' + s + '"' + (s === state.stage ? ' selected' : '') + '>' + s + '</option>';
  });
  html += '</select></div>';
  html += '<div><label>' + t('level') + '</label>';
  html += '<select id="sel-level">';
  ['L1', 'L2', 'L3'].forEach(function(l) {
    html += '<option value="' + l + '"' + (l === state.level ? ' selected' : '') + '>' + l + '</option>';
  });
  html += '</select></div>';
  html += '</div>';
  html += '<div class="inspector-layout">';
  html += '<div id="inspector-input"></div>';
  html += '<div id="inspector-output"></div>';
  html += '</div>';
  html += '<div class="section" style="margin-top:1.5rem">';
  html += '<h2 class="section-title">' + t('inspector_matrix') + '</h2>';
  html += '<div class="card" id="inspector-matrix"></div>';
  html += '</div>';
  html += '</div>';

  html += '</div>';
  container.innerHTML = html;

  renderFilterPills(data, state);
  renderBugList(data, state);
  renderInspectorContent(data, state);

  document.getElementById('bug-search').addEventListener('input', function() {
    state.search = this.value;
    renderBugList(data, state);
  });

  ['sel-model', 'sel-stage', 'sel-level'].forEach(function(id) {
    document.getElementById(id).addEventListener('change', function() {
      state.model = document.getElementById('sel-model').value;
      state.stage = document.getElementById('sel-stage').value;
      state.level = document.getElementById('sel-level').value;
      renderBugList(data, state);
      renderInspectorContent(data, state);
    });
  });
};

function getFilteredBugs(data, state) {
  var bugs = data.bugs;
  var q = (state.search || '').toLowerCase().trim();
  var filters = state.filters || {};

  return bugs.filter(function(bug) {
    if (q) {
      var haystack = (bug.instance_id + ' ' + (bug.repo || '') + ' ' + (bug.ground_truth.files || []).join(' ')).toLowerCase();
      if (haystack.indexOf(q) === -1) return false;
    }
    if (filters.complexity && bug.complexity !== filters.complexity) return false;
    if (filters.bug_type && bug.bug_type !== filters.bug_type) return false;
    return true;
  });
}

function renderFilterPills(data, state) {
  var el = document.getElementById('filter-pills');
  var filters = state.filters || {};
  var html = '';

  ['S', 'M', 'C'].forEach(function(c) {
    var active = filters.complexity === c ? ' active' : '';
    html += '<button class="inspector-filter-pill complexity-' + c + active + '" data-filter="complexity" data-value="' + c + '">' + tComplexity(c) + '</button>';
  });

  var types = ['LOGIC', 'MISSING_HANDLER', 'API_TYPE', 'CONFIG', 'MISSING_CHECK'];
  types.forEach(function(typ) {
    var active = filters.bug_type === typ ? ' active' : '';
    html += '<button class="inspector-filter-pill' + active + '" data-filter="bug_type" data-value="' + typ + '">' + tType(typ) + '</button>';
  });

  el.innerHTML = html;

  el.querySelectorAll('.inspector-filter-pill').forEach(function(pill) {
    pill.addEventListener('click', function() {
      var key = this.getAttribute('data-filter');
      var val = this.getAttribute('data-value');
      if (filters[key] === val) {
        delete filters[key];
      } else {
        filters[key] = val;
      }
      state.filters = filters;
      renderFilterPills(data, state);
      renderBugList(data, state);
    });
  });
}

function getBugShortName(instanceId) {
  var parts = instanceId.split('__');
  return parts.length > 1 ? parts[1] : instanceId;
}

function renderBugList(data, state) {
  var listEl = document.getElementById('bug-list');
  var countEl = document.getElementById('sidebar-count');
  var filtered = getFilteredBugs(data, state);
  var models = data.metadata.models;
  var condKey = state.stage + '_' + state.level;

  countEl.textContent = filtered.length < data.bugs.length
    ? t('inspector_showing') + ' ' + filtered.length + ' ' + t('inspector_of') + ' ' + data.bugs.length
    : filtered.length + ' bugs';

  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="inspector-no-match">' + lucideIcon('search-x', {size:'2rem', color:'var(--text-muted)'}) + '<div style="margin-top:0.5rem">' + t('inspector_no_match') + '</div></div>';
    return;
  }

  var html = '';

  filtered.forEach(function(bug) {
    var realIdx = data.bugs.indexOf(bug);
    var selected = realIdx === state.bugIdx ? ' selected' : '';
    var shortName = getBugShortName(bug.instance_id);
    var gtFile = bug.ground_truth.files[0] || '';
    var gtShort = gtFile.length > 35 ? '...' + gtFile.slice(-32) : gtFile;

    html += '<div class="inspector-bug-card' + selected + '" data-idx="' + realIdx + '">';

    html += '<div class="inspector-bug-card-row1">';
    html += '<span class="inspector-bug-name">' + escapeHtml2(shortName) + '</span>';
    html += '<span class="inspector-badge inspector-badge-' + bug.complexity + '">' + bug.complexity + '</span>';
    html += '</div>';

    html += '<div class="inspector-bug-card-row2">';
    html += '<span class="inspector-bug-repo">' + escapeHtml2(bug.repo || '') + '</span>';
    html += '<span class="inspector-badge inspector-badge-type">' + escapeHtml2(bug.bug_type || '') + '</span>';
    html += '</div>';

    html += '<div class="inspector-bug-gt">' + escapeHtml2(gtShort) + '</div>';

    html += '<div class="inspector-bug-dots" title="' + models.join(', ') + ' (' + condKey + ')">';
    models.forEach(function(model) {
      var sanitized = model.replace(/:/g, '-').replace(/\//g, '-');
      var mr = bug.results[sanitized] || bug.results[model] || {};
      var r = mr[condKey];
      var cls = 'none';
      if (r && r.predictions && r.predictions.length > 0) {
        var stage = condKey.split('_')[0];
        if (stage === 'stage1') {
          var hit = bug.ground_truth.files.some(function(f) { return normPath(f) === normPath(String(r.predictions[0])); });
          cls = hit ? 'hit' : 'miss';
        } else {
          var allGtLines = getGtLines(bug);
          cls = rangeOverlapsGt(r.predictions[0], allGtLines) ? 'hit' : 'miss';
        }
      }
      html += '<span class="inspector-model-dot ' + cls + '" title="' + model + '"></span>';
    });
    html += '</div>';

    html += '</div>';
  });

  listEl.innerHTML = html;

  listEl.querySelectorAll('.inspector-bug-card').forEach(function(card) {
    card.addEventListener('click', function() {
      var idx = parseInt(this.getAttribute('data-idx'));
      state.bugIdx = idx;
      renderBugList(data, state);
      renderInspectorContent(data, state);
    });
  });

  var selectedCard = listEl.querySelector('.inspector-bug-card.selected');
  if (selectedCard) {
    var listRect = listEl.getBoundingClientRect();
    var cardRect = selectedCard.getBoundingClientRect();
    if (cardRect.top < listRect.top || cardRect.bottom > listRect.bottom) {
      selectedCard.scrollIntoView({ block: 'nearest' });
    }
  }
}

function getGtLines(bug) {
  var allGtLines = [];
  Object.values(bug.ground_truth.lines).forEach(function(lines) {
    lines.forEach(function(l) { if (allGtLines.indexOf(l) === -1) allGtLines.push(l); });
  });
  return allGtLines.sort(function(a,b){return a-b;});
}

function rangeOverlapsGt(pred, gtLines) {
  if (!pred || !gtLines || gtLines.length === 0) return false;
  if (Array.isArray(pred) && pred.length === 2) {
    var lo = parseInt(pred[0]), hi = parseInt(pred[1]);
    for (var i = 0; i < gtLines.length; i++) {
      if (gtLines[i] >= lo && gtLines[i] <= hi) return true;
    }
    return false;
  }
  var n = parseInt(pred);
  if (!isNaN(n)) return gtLines.indexOf(n) !== -1;
  return false;
}

function rangeOverlapsGtFuzzy(pred, gtLines, tolerance) {
  if (!pred || !gtLines || gtLines.length === 0) return false;
  if (Array.isArray(pred) && pred.length === 2) {
    var lo = parseInt(pred[0]) - tolerance, hi = parseInt(pred[1]) + tolerance;
    for (var i = 0; i < gtLines.length; i++) {
      if (gtLines[i] >= lo && gtLines[i] <= hi) return true;
    }
    return false;
  }
  var n = parseInt(pred);
  if (!isNaN(n)) {
    for (var j = 0; j < gtLines.length; j++) {
      if (Math.abs(gtLines[j] - n) <= tolerance) return true;
    }
  }
  return false;
}

function formatPrediction(pred, stage) {
  if (stage === 'stage2' && Array.isArray(pred) && pred.length === 2) {
    return pred[0] + '-' + pred[1];
  }
  return String(pred);
}

function renderInspectorContent(data, state) {
  var bug = data.bugs[state.bugIdx];
  var ctx = bug.context;
  var allGtLines = getGtLines(bug);

  var inputEl = document.getElementById('inspector-input');
  var outputEl = document.getElementById('inspector-output');
  var matrixEl = document.getElementById('inspector-matrix');

  var inputHtml = '<div class="card">';
  inputHtml += '<h3 style="color:var(--text-primary);margin-bottom:1rem">' + t('inspector_input') + '</h3>';

  inputHtml += '<div style="margin-bottom:1rem">';
  inputHtml += '<strong style="color:var(--accent)">' + t('inspector_gt_info') + ':</strong> ';
  inputHtml += '<span style="font-family:monospace">' + bug.ground_truth.files.join(', ') + '</span>';
  inputHtml += ' | Lines: <span style="color:var(--accent-orange)">';
  inputHtml += allGtLines.join(', ') + '</span></div>';

  inputHtml += '<div style="margin-bottom:0.75rem"><strong>' + t('inspector_ps') + ':</strong></div>';
  inputHtml += '<div class="code-block"><pre>' + escapeHtml2(ctx.problem_statement || '') + '</pre></div>';

  if (state.stage === 'stage1') {
    if (state.level === 'L1') {
      inputHtml += '<div style="margin:0.75rem 0"><strong>' + t('inspector_file_list') + ' (' + ctx.file_count + ' files):</strong></div>';
      inputHtml += '<div class="code-block" style="max-height:300px"><pre>' + escapeHtml2((ctx.file_list || []).join('\n')) + '</pre></div>';
    } else {
      inputHtml += '<div style="margin:0.75rem 0"><strong>' + t('inspector_ast') + ' (' + (ctx.ast_summary_chars || 0).toLocaleString() + ' chars):</strong></div>';
      inputHtml += '<div class="code-block" style="max-height:300px"><pre>' + escapeHtml2((ctx.ast_summary || '').substring(0, 5000)) + (ctx.ast_summary && ctx.ast_summary.length > 5000 ? '\n... (truncated)' : '') + '</pre></div>';
    }
    if (state.level === 'L3') {
      inputHtml += '<div style="margin:0.75rem 0"><strong>' + t('inspector_tests') + ':</strong></div>';
      inputHtml += '<div class="code-block" style="max-height:200px"><pre>' + escapeHtml2((ctx.test_names || []).join('\n')) + '</pre></div>';
    }
  } else {
    inputHtml += '<div style="margin:0.75rem 0"><strong>' + t('inspector_source') + ' (' + ctx.source_lines + ' lines, ' + ctx.gt_file + '):</strong></div>';
    var predRanges = [];
    var sModel = state.model.replace(/:/g, '-').replace(/\//g, '-');
    var sCondKey = state.stage + '_' + state.level;
    var sRes = (bug.results[sModel] || bug.results[state.model] || {})[sCondKey];
    if (sRes && sRes.predictions) predRanges = sRes.predictions;
    inputHtml += renderSourceCode(ctx.source_code || '', allGtLines, predRanges);
    if (state.level >= 'L2') {
      inputHtml += '<div style="margin:0.75rem 0"><strong>' + t('inspector_tests') + ':</strong></div>';
      inputHtml += '<div class="code-block" style="max-height:200px"><pre>' + escapeHtml2((ctx.test_names || []).join('\n')) + '</pre></div>';
    }
    if (state.level === 'L3') {
      var testCode = formatTestCode(ctx.test_code);
      if (testCode) {
        inputHtml += '<div class="code-block" style="max-height:200px"><pre>' + escapeHtml2(testCode.substring(0, 3000)) + '</pre></div>';
      }
    }
  }

  if (bug.fix_info) {
    var fi = bug.fix_info;
    inputHtml += '<div style="margin:1rem 0 0.75rem">';
    inputHtml += '<strong>' + t('inspector_fix_info') + ':</strong></div>';
    inputHtml += '<div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:0.82rem;margin-bottom:0.75rem;padding:0.75rem;background:var(--bg-tertiary);border-radius:var(--radius-sm);border:1px solid var(--border)">';
    if (fi.pr_url) {
      inputHtml += '<span style="color:var(--text-muted)">PR:</span>';
      inputHtml += '<span><a href="' + escapeHtml2(fi.pr_url) + '" target="_blank" style="color:var(--accent-blue)">';
      inputHtml += '#' + fi.pr_number + '</a>';
      inputHtml += ' <span style="color:var(--text-primary)">' + escapeHtml2(fi.pr_title || '') + '</span></span>';
    }
    if (fi.commit_author) {
      inputHtml += '<span style="color:var(--text-muted)">' + t('inspector_author') + ':</span>';
      inputHtml += '<span style="color:var(--text-secondary)">' + escapeHtml2(fi.commit_author) + '</span>';
    }
    if (fi.commit_date) {
      inputHtml += '<span style="color:var(--text-muted)">' + t('inspector_date') + ':</span>';
      inputHtml += '<span style="color:var(--text-secondary)">' + escapeHtml2(fi.commit_date) + '</span>';
    }
    if (fi.fix_commit) {
      inputHtml += '<span style="color:var(--text-muted)">Commit:</span>';
      inputHtml += '<span style="color:var(--text-secondary);font-family:monospace;font-size:0.78rem">' + escapeHtml2(fi.fix_commit.substring(0,12)) + '</span>';
    }
    if (fi.pr_labels && fi.pr_labels.length > 0) {
      inputHtml += '<span style="color:var(--text-muted)">Labels:</span>';
      inputHtml += '<span>';
      fi.pr_labels.forEach(function(label) {
        inputHtml += '<span style="background:var(--accent-blue);color:#fff;padding:1px 6px;border-radius:3px;font-size:0.7rem;margin-right:4px">' + escapeHtml2(label) + '</span>';
      });
      inputHtml += '</span>';
    }
    if (fi.pr_additions != null || fi.pr_deletions != null) {
      inputHtml += '<span style="color:var(--text-muted)">' + t('inspector_changes') + ':</span>';
      inputHtml += '<span><span style="color:var(--accent-green)">+' + (fi.pr_additions || 0) + '</span>';
      inputHtml += ' <span style="color:var(--accent-red)">-' + (fi.pr_deletions || 0) + '</span></span>';
    }
    if (fi.file_diffs && fi.file_diffs.length > 0) {
      var funcs = [];
      fi.file_diffs.forEach(function(fd) {
        (fd.changed_functions || []).forEach(function(fn) {
          if (funcs.indexOf(fn) === -1) funcs.push(fn);
        });
      });
      if (funcs.length > 0) {
        inputHtml += '<span style="color:var(--text-muted)">' + t('inspector_functions') + ':</span>';
        inputHtml += '<span style="color:var(--accent-orange);font-family:monospace;font-size:0.78rem">' + funcs.map(escapeHtml2).join(', ') + '</span>';
      }
    }
    inputHtml += '</div>';

    if (fi.pr_body) {
      var prBodyTrimmed = fi.pr_body.length > 800 ? fi.pr_body.substring(0, 800) + '...' : fi.pr_body;
      inputHtml += '<details style="margin-bottom:0.75rem"><summary style="cursor:pointer;color:var(--text-muted);font-size:0.8rem">PR Description</summary>';
      inputHtml += '<div class="code-block" style="max-height:200px;font-size:0.78rem"><pre>' + escapeHtml2(prBodyTrimmed) + '</pre></div>';
      inputHtml += '</details>';
    }
  }

  if (bug.fix_info && bug.fix_info.file_diffs && bug.fix_info.file_diffs[0] && bug.fix_info.file_diffs[0].diff) {
    inputHtml += '<div style="margin:0.5rem 0 0.5rem"><strong>' + t('inspector_diff') + ':</strong>';
    inputHtml += ' <span style="color:var(--text-muted);font-size:0.8rem">' + t('inspector_diff_desc') + '</span></div>';
    inputHtml += renderDiffView(bug.fix_info.file_diffs[0].diff);
  } else if (bug.patch) {
    inputHtml += '<div style="margin:0.5rem 0 0.5rem"><strong>' + t('inspector_diff') + ':</strong>';
    inputHtml += ' <span style="color:var(--text-muted);font-size:0.8rem">' + t('inspector_diff_desc') + '</span></div>';
    inputHtml += renderDiffView(bug.patch);
  }

  inputHtml += '</div>';
  inputEl.innerHTML = inputHtml;

  var outputHtml = '<div class="card">';
  outputHtml += '<h3 style="color:var(--text-primary);margin-bottom:1rem">' + t('inspector_output') + '</h3>';

  var sanitizedModel = state.model.replace(/:/g, '-').replace(/\//g, '-');
  var condKey = state.stage + '_' + state.level;
  var modelResults = bug.results[sanitizedModel] || bug.results[state.model] || {};
  var result = modelResults[condKey];

  if (!data.has_results || !result) {
    outputHtml += '<div class="no-results-container" style="min-height:200px">';
    outputHtml += '<div class="no-results-icon">' + lucideIcon('loader', {size:'4rem', color:'var(--text-muted)'}) + '</div>';
    outputHtml += '<div class="no-results-text">' + t('no_results') + '</div>';
    outputHtml += '</div>';
  } else {
    outputHtml += '<div style="margin-bottom:0.75rem"><strong>' + t('predictions') + ':</strong></div>';
    outputHtml += '<div style="margin-bottom:1rem">';
    (result.predictions || []).forEach(function(pred, i) {
      var isHit, isFuzzy;
      if (state.stage === 'stage1') {
        isHit = bug.ground_truth.files.some(function(f) { return normPath(f) === normPath(String(pred)); });
        isFuzzy = false;
      } else {
        isHit = rangeOverlapsGt(pred, allGtLines);
        isFuzzy = !isHit && rangeOverlapsGtFuzzy(pred, allGtLines, 1);
      }
      var icon, label;
      if (isHit) {
        icon = lucideIcon('check-circle', {size:'0.9em', color:'var(--accent-green)'});
        label = '';
      } else if (isFuzzy) {
        icon = lucideIcon('circle-dot', {size:'0.9em', color:'var(--accent-yellow)'});
        label = ' <span style="color:var(--accent-yellow);font-size:0.7rem">\u00b11</span>';
      } else {
        icon = lucideIcon('x-circle', {size:'0.9em', color:'var(--accent-orange)'});
        label = '';
      }
      outputHtml += '<div style="padding:3px 0;font-family:monospace;font-size:0.8rem">' + icon + ' ' + (i+1) + '. ' + escapeHtml2(formatPrediction(pred, state.stage)) + label + '</div>';
    });
    outputHtml += '</div>';

    outputHtml += '<div style="margin-bottom:0.75rem"><strong>' + t('ground_truth') + ':</strong></div>';
    outputHtml += '<div style="margin-bottom:1rem;font-family:monospace;font-size:0.8rem;color:var(--accent-orange)">';
    if (state.stage === 'stage1') {
      outputHtml += bug.ground_truth.files.join('<br>');
    } else {
      outputHtml += allGtLines.join(', ');
    }
    outputHtml += '</div>';

    var metrics = (bug.metrics[sanitizedModel] || bug.metrics[state.model] || {})[condKey];
    if (metrics) {
      outputHtml += '<div style="margin-bottom:0.75rem"><strong>' + t('inspector_evaluation') + ':</strong></div>';
      outputHtml += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:0.8rem">';
      Object.keys(metrics).forEach(function(k) {
        var v = typeof metrics[k] === 'number' ? metrics[k].toFixed(3) : metrics[k];
        var colorStyle = '';
        if (typeof metrics[k] === 'number') {
          if (metrics[k] >= 0.8) colorStyle = 'color:var(--accent-green)';
          else if (metrics[k] >= 0.4) colorStyle = 'color:var(--accent-yellow)';
          else if (metrics[k] > 0) colorStyle = 'color:var(--accent-orange)';
          else colorStyle = 'color:var(--text-muted)';
        }
        outputHtml += '<div style="padding:4px 6px;background:var(--bg-tertiary);border-radius:4px">';
        outputHtml += '<span style="color:var(--text-muted)">' + k + '</span> ';
        outputHtml += '<span style="' + (colorStyle || 'color:var(--accent)') + ';font-weight:600">' + v + '</span></div>';
      });
      outputHtml += '</div>';
    }

    outputHtml += '<div style="margin-top:0.75rem;font-size:0.75rem;color:var(--text-muted)">';
    outputHtml += t('duration') + ': ' + ((result.duration_ms || 0) / 1000).toFixed(1) + 's';
    outputHtml += ' | ' + t('parse_success') + ': ' + (result.parse_success ? lucideIcon('check-circle', {size:'0.9em', color:'var(--accent-green)'}) : lucideIcon('x-circle', {size:'0.9em', color:'var(--accent-orange)'}));
    outputHtml += '</div>';

    outputHtml += '<div style="margin-top:1rem"><strong>Raw Output:</strong></div>';
    outputHtml += '<div class="code-block" style="max-height:200px"><pre>' + escapeHtml2(result.raw_output || '') + '</pre></div>';
  }
  outputHtml += '</div>';
  outputEl.innerHTML = outputHtml;

  renderConditionMatrix(matrixEl, bug, data);
}

function renderDiffView(patch) {
  if (!patch) return '';
  var lines = patch.split('\n');
  var html = '<div class="diff-view"><pre>';
  lines.forEach(function(line) {
    var cls = 'diff-line';
    if (line.startsWith('+++') || line.startsWith('---')) {
      cls += ' diff-file-header';
    } else if (line.startsWith('@@')) {
      cls += ' diff-hunk-header';
    } else if (line.startsWith('+')) {
      cls += ' diff-add';
    } else if (line.startsWith('-')) {
      cls += ' diff-del';
    } else if (line.startsWith('diff ')) {
      cls += ' diff-file-header';
    }
    html += '<span class="' + cls + '">' + escapeHtml2(line) + '</span>\n';
  });
  html += '</pre></div>';
  return html;
}

function renderConditionMatrix(el, bug, data) {
  var models = data.metadata.models;
  var conditions = data.metadata.conditions;
  var modelColors = ['var(--model-1)', 'var(--model-2)', 'var(--model-3)', 'var(--model-4)', 'var(--accent-yellow)', 'var(--accent-orange)'];
  var allGtLines = getGtLines(bug);

  var html = '<div class="condition-matrix">';
  html += '<div class="matrix-header"></div>';
  conditions.forEach(function(c) {
    html += '<div class="matrix-header">' + c.replace('_', '<br>') + '</div>';
  });

  models.forEach(function(model, mi) {
    html += '<div class="matrix-model" style="color:' + modelColors[mi] + '">' + model + '</div>';
    var sanitized = model.replace(/:/g, '-').replace(/\//g, '-');
    conditions.forEach(function(cond) {
      var modelResults = bug.results[sanitized] || bug.results[model] || {};
      var result = modelResults[cond];
      if (!result) {
        html += '<div class="matrix-cell matrix-empty" data-model="' + model + '" data-cond="' + cond + '">' + lucideIcon('minus-square', {size:'1em', color:'var(--text-muted)'}) + '</div>';
      } else {
        var stage = cond.split('_')[0];
        var preds = result.predictions || [];
        var hit = false;
        var fuzzy = false;
        if (stage === 'stage1') {
          hit = preds.length > 0 && bug.ground_truth.files.some(function(f) { return normPath(f) === normPath(String(preds[0])); });
        } else {
          hit = preds.length > 0 && rangeOverlapsGt(preds[0], allGtLines);
          fuzzy = !hit && preds.length > 0 && rangeOverlapsGtFuzzy(preds[0], allGtLines, 1);
        }
        var cls, icon;
        if (hit) {
          cls = 'matrix-hit';
          icon = lucideIcon('check-circle', {size:'1em', color:'var(--accent-green)'});
        } else if (fuzzy) {
          cls = 'matrix-partial';
          icon = lucideIcon('circle-dot', {size:'1em', color:'var(--accent-yellow)'});
        } else {
          cls = 'matrix-miss';
          icon = lucideIcon('x-circle', {size:'1em', color:'var(--accent-orange)'});
        }
        html += '<div class="matrix-cell ' + cls + '" data-model="' + model + '" data-cond="' + cond + '">' + icon + '</div>';
      }
    });
  });
  html += '</div>';
  el.innerHTML = html;

  el.querySelectorAll('.matrix-cell').forEach(function(cell) {
    cell.addEventListener('click', function() {
      var model = this.getAttribute('data-model');
      var cond = this.getAttribute('data-cond');
      var parts = cond.split('_');
      document.getElementById('sel-model').value = model;
      document.getElementById('sel-stage').value = parts[0];
      document.getElementById('sel-level').value = parts[1];
      var state = window.inspectorState;
      state.model = model;
      state.stage = parts[0];
      state.level = parts[1];
      renderInspectorContent(window.APP_DATA, state);
    });
  });
}

function renderSourceCode(code, gtLines, predRanges) {
  if (!code) return '<div class="code-block"><pre>(empty)</pre></div>';
  var lines = code.split('\n');
  var gtSet = {};
  (gtLines || []).forEach(function(l) { gtSet[l] = true; });
  var predSet = {};
  (predRanges || []).forEach(function(r) {
    if (Array.isArray(r) && r.length === 2) {
      for (var n = parseInt(r[0]); n <= parseInt(r[1]); n++) predSet[n] = true;
    }
  });
  var firstGt = (gtLines && gtLines.length > 0) ? gtLines[0] : null;
  var html = '<div class="code-block" style="max-height:500px" id="source-scroll"><pre>';
  lines.forEach(function(line, i) {
    var lineNum = i + 1;
    var content = line;
    var match = line.match(/^\s*(\d+):\s?(.*)/);
    if (match) {
      lineNum = parseInt(match[1]);
      content = match[2];
    }
    var isGt = gtSet[lineNum];
    var isPred = predSet[lineNum];
    var cls = '';
    if (isGt && isPred) cls = ' gt-pred-line';
    else if (isGt) cls = ' gt-line';
    else if (isPred) cls = ' pred-line';
    var anchor = (lineNum === firstGt) ? ' id="gt-anchor"' : '';
    html += '<span class="code-line' + cls + '"' + anchor + '>';
    html += '<span class="code-line-number">' + lineNum + '</span>';
    html += escapeHtml2(content);
    html += '</span>\n';
  });
  html += '</pre></div>';
  if (firstGt) {
    html += '<script>setTimeout(function(){var a=document.getElementById("gt-anchor");if(a){var p=a.closest(".code-block");if(p)p.scrollTop=a.offsetTop-p.offsetTop-100;}},50);<\/script>';
  }
  return html;
}

function formatTestCode(testCode) {
  if (!testCode) return '';
  if (typeof testCode === 'string') return testCode;
  if (Array.isArray(testCode)) {
    return testCode.map(function(tc) {
      if (typeof tc === 'string') return tc;
      if (tc && tc.code) return tc.code;
      return '';
    }).filter(Boolean).join('\n\n');
  }
  return '';
}

function normPath(p) {
  return p.replace(/^\.\//, '').replace(/^\//, '');
}

function escapeHtml2(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
