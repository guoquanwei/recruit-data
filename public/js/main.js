document.documentElement.dataset.appReady = 'true';

const SIDEBAR_STORAGE_KEY = 'recruitAdminSidebarCollapsed';
const adminShell = document.querySelector('.admin-shell');

function setSidebarCollapsed(collapsed) {
  if (!adminShell) {
    return;
  }

  adminShell.classList.toggle('sidebar-collapsed', collapsed);
  localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? '1' : '0');
  document.querySelectorAll('[data-sidebar-toggle]').forEach((button) => {
    button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    button.setAttribute('aria-label', collapsed ? '展开导航' : '收起导航');
  });
}

setSidebarCollapsed(localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1');

document.querySelectorAll('[data-sidebar-toggle]').forEach((button) => {
  button.addEventListener('click', (event) => {
    event.preventDefault();
    setSidebarCollapsed(!adminShell?.classList.contains('sidebar-collapsed'));
  });
});

document.querySelectorAll('[data-reset-form]').forEach((button) => {
  button.addEventListener('click', () => {
    const form = button.closest('form');
    if (!form) {
      return;
    }

    form.querySelectorAll('input, select').forEach((field) => {
      field.value = '';
    });
    form.querySelectorAll('[data-search-select]').forEach((select) => {
      select.querySelector('[data-search-select-input]').value = '全部';
      select.querySelector('input[type="hidden"]').value = '';
      select.querySelectorAll('[data-search-select-option]').forEach((option) => {
        option.classList.toggle('active', option.dataset.value === '');
        option.hidden = false;
      });
      select.classList.remove('is-empty');
    });
    syncClearButtons(form);
    form.submit();
  });
});

function syncClearButtons(scope = document) {
  scope.querySelectorAll('[data-clear-input]').forEach((button) => {
    const field = button.parentElement.querySelector('input');
    button.classList.toggle('is-visible', Boolean(field?.value));
  });

  scope.querySelectorAll('[data-search-select]').forEach((select) => {
    const clearButton = select.querySelector('[data-search-select-clear]');
    const hiddenInput = select.querySelector('input[type="hidden"]');
    if (clearButton) {
      clearButton.classList.toggle('is-visible', Boolean(hiddenInput?.value));
    }
  });

  scope.querySelectorAll('[data-date-picker-clear]').forEach((button) => {
    const field = button.closest('.date-picker-shell')?.previousElementSibling;
    button.classList.toggle('is-visible', Boolean(field?.value));
  });
}

document.querySelectorAll('[data-clear-input]').forEach((button) => {
  button.addEventListener('click', () => {
    const field = button.parentElement.querySelector('input');
    if (!field) {
      return;
    }

    field.value = '';
    field.focus({ preventScroll: true });
    field.dispatchEvent(new Event('input', { bubbles: true }));
    syncClearButtons();
  });
});

document.querySelectorAll('[data-page-size-select]').forEach((select) => {
  select.addEventListener('change', () => {
    select.form?.submit();
  });
});

document.querySelectorAll('[data-page-jump-form]').forEach((form) => {
  const input = form.querySelector('[data-page-jump-input]');
  const totalPages = Number(form.dataset.totalPages || 1);
  const submitPage = () => {
    const rawValue = Number(input.value || 1);
    input.value = String(Math.min(totalPages, Math.max(1, rawValue)));
    form.submit();
  };

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitPage();
    }
  });
  input.addEventListener('change', submitPage);
});

function getTooltip() {
  let tooltip = document.querySelector('[data-option-tooltip]');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'option-tooltip';
    tooltip.dataset.optionTooltip = 'true';
    document.body.appendChild(tooltip);
  }

  return tooltip;
}

function showTextTooltip(element, text) {
  const label = text || element.dataset.label || element.textContent.trim();
  const isOverflowing = element.scrollWidth > element.clientWidth;

  if (label.length <= 15 && !isOverflowing) {
    hideOptionTooltip();
    return;
  }

  const rect = element.getBoundingClientRect();
  const tooltip = getTooltip();

  tooltip.textContent = label;
  tooltip.classList.add('is-visible');

  const top = Math.max(8, rect.top - 34);
  const left = Math.min(rect.left, window.innerWidth - tooltip.offsetWidth - 8);
  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${Math.max(8, left)}px`;
}

function showOptionTooltip(option) {
  showTextTooltip(option, option.dataset.label || option.textContent.trim());
}

function hideOptionTooltip() {
  document.querySelector('[data-option-tooltip]')?.classList.remove('is-visible');
}

function closeSearchSelects(except) {
  document.querySelectorAll('[data-search-select]').forEach((select) => {
    if (select !== except) {
      restoreSearchSelectLabel(select);
      select.classList.remove('open');
    }
  });
}

function findSearchSelectOption(select, value) {
  return Array.from(select.querySelectorAll('[data-search-select-option]'))
    .find((option) => (option.dataset.value || '') === (value || ''));
}

function restoreSearchSelectLabel(select) {
  const hiddenInput = select.querySelector('input[type="hidden"]');
  const searchInput = select.querySelector('[data-search-select-input]');
  const selectedOption = findSearchSelectOption(select, hiddenInput?.value || '');
  if (searchInput && selectedOption && searchInput.value.trim() === '') {
    searchInput.value = selectedOption.dataset.label || selectedOption.textContent;
  }
}

function filterSearchSelectOptions(select) {
  const searchable = select.dataset.searchable === '1';
  const input = select.querySelector('[data-search-select-input]');
  const hiddenInput = select.querySelector('input[type="hidden"]');
  const rawQuery = input.value.trim();
  const query = !searchable || (hiddenInput.value === '' && rawQuery === '全部') ? '' : rawQuery.toLowerCase();
  let visibleCount = 0;

  select.querySelectorAll('[data-search-select-option]').forEach((option) => {
    const label = option.dataset.label || option.textContent;
    const visible = label.toLowerCase().includes(query);
    option.hidden = !visible;
    if (visible) {
      visibleCount += 1;
    }
  });

  select.classList.toggle('is-empty', visibleCount === 0);
}

document.querySelectorAll('[data-search-select]').forEach((select) => {
  const hiddenInput = select.querySelector('input[type="hidden"]');
  const searchInput = select.querySelector('[data-search-select-input]');
  const toggle = select.querySelector('[data-search-select-toggle]');
  const searchable = select.dataset.searchable === '1';

  function showAllOptionsForCurrentSelection() {
    if (!searchable || !hiddenInput.value) {
      return;
    }
    const selectedOption = findSearchSelectOption(select, hiddenInput.value);
    const selectedLabel = selectedOption?.dataset.label || selectedOption?.textContent || '';
    if (searchInput.value === selectedLabel) {
      searchInput.value = '';
    }
  }

  function openSelect() {
    closeSearchSelects(select);
    showAllOptionsForCurrentSelection();
    select.classList.add('open');
    filterSearchSelectOptions(select);
  }

  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    openSelect();
    if (searchable) {
      searchInput.focus({ preventScroll: true });
    }
  });

  searchInput.addEventListener('click', (event) => {
    event.stopPropagation();
    openSelect();
  });

  searchInput.addEventListener('focus', () => {
    if (searchable) {
      openSelect();
    }
  });

  searchInput.addEventListener('input', () => {
    if (!searchable) {
      return;
    }
    hiddenInput.value = '';
    select.querySelectorAll('[data-search-select-option]').forEach((item) => {
      item.classList.remove('active');
    });
    filterSearchSelectOptions(select);
    syncClearButtons();
  });

  select.querySelector('[data-search-select-clear]')?.addEventListener('click', (event) => {
    event.stopPropagation();
    hiddenInput.value = '';
    searchInput.value = '全部';
    select.querySelectorAll('[data-search-select-option]').forEach((item) => {
      item.classList.toggle('active', item.dataset.value === '');
      item.hidden = false;
    });
    select.classList.remove('is-empty');
    syncClearButtons();
  });

  function applySearchSelectOption(option) {
    hideOptionTooltip();
    hiddenInput.value = option.dataset.value || '';
    searchInput.value = option.dataset.label || option.textContent;
    select.querySelectorAll('[data-search-select-option]').forEach((item) => {
      item.classList.toggle('active', item === option);
      item.hidden = false;
    });
    select.classList.remove('open', 'is-empty');
    syncClearButtons();
  }

  select.querySelectorAll('[data-search-select-option]').forEach((option) => {
    option.addEventListener('mouseenter', () => showOptionTooltip(option));
    option.addEventListener('mouseleave', hideOptionTooltip);
    option.addEventListener('focus', () => showOptionTooltip(option));
    option.addEventListener('blur', hideOptionTooltip);
    option.addEventListener('mousedown', (event) => {
      event.preventDefault();
    });
    option.addEventListener('click', (event) => {
      event.stopPropagation();
      applySearchSelectOption(option);
    });
  });
});

document.querySelectorAll('.clearable-field input').forEach((field) => {
  field.addEventListener('input', () => syncClearButtons());
});

document.querySelectorAll('.table tbody td').forEach((cell) => {
  cell.addEventListener('mouseenter', () => showTextTooltip(cell));
  cell.addEventListener('mouseleave', hideOptionTooltip);
});

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderPositionBatchActionPlans(actionPlans = []) {
  const actionGrid = document.querySelector('[data-channel-action-grid]');
  if (!actionGrid) {
    return;
  }

  actionGrid.innerHTML = actionPlans.map((plan) => `
    <article class="channel-action-card channel-action-${escapeHtml(plan.status)}">
      <div class="channel-action-head">
        <h3>${escapeHtml(plan.title)}</h3>
        <span>${escapeHtml(plan.owner)} · ${escapeHtml(plan.statusText)}</span>
      </div>
      <em>关注：${escapeHtml(plan.focus)}</em>
      <p>${escapeHtml(plan.diagnosis)}</p>
      ${plan.communicationScript ? `<blockquote>${escapeHtml(plan.communicationScript)}</blockquote>` : ''}
      <ol>
        ${(plan.actions || []).map((action) => `<li>${escapeHtml(action)}</li>`).join('')}
      </ol>
    </article>
  `).join('');
}

function renderPositionBatchPanel(batch) {
  if (!batch) {
    return;
  }

  renderPositionBatchFunnel(batch);
  renderPositionBatchActionPlans(batch.actionPlans || []);

  const mainRiskText = document.querySelector('[data-position-main-risk-text]');
  if (mainRiskText && batch.mainRiskText) {
    mainRiskText.textContent = batch.mainRiskText;
  }
}

function renderPositionBatchFunnel(batch) {
  const tableBody = document.querySelector('[data-funnel-diagnosis-body]');
  if (!tableBody || !batch) {
    return;
  }

  tableBody.innerHTML = (batch.funnelRows || []).map((row) => `
    <tr>
      <td><span class="channel-dot channel-dot-${escapeHtml(row.status)}" title="${escapeHtml(row.statusText)}"></span>${escapeHtml(row.channel)}</td>
      <td><span class="position-status position-status-${escapeHtml(row.status)}">${escapeHtml(row.statusText)}</span></td>
      <td>${escapeHtml(row.arrivedCount)}</td>
      <td>${escapeHtml(row.passedCount)}</td>
      <td>${escapeHtml(row.trainingCount)}</td>
      <td>${escapeHtml(row.passRateText)}</td>
      <td>${escapeHtml(row.trainingRateText)}</td>
    </tr>
  `).join('');

  const selectedLabel = document.querySelector('[data-selected-batch-label]');
  if (selectedLabel) {
    selectedLabel.textContent = `已选择：${batch.label}`;
  }
}

function setupPositionBatchSwitch() {
  const payloadElement = document.getElementById('positionBatchPayload');
  if (!payloadElement) {
    return;
  }

  let payload;
  try {
    payload = JSON.parse(payloadElement.textContent);
  } catch (error) {
    return;
  }

  const batchMap = new Map((payload.batches || []).map((batch) => [String(batch.day), batch]));
  document.querySelectorAll('[data-position-batch-card]').forEach((card) => {
    card.addEventListener('click', (event) => {
      const batch = batchMap.get(String(card.dataset.batchDay));
      if (!batch) {
        return;
      }

      event.preventDefault();
      document.querySelectorAll('[data-position-batch-card]').forEach((item) => {
        item.classList.toggle('active', item === card);
      });
      renderPositionBatchPanel(batch);

      const url = new URL(window.location.href);
      url.searchParams.set('selectedBatchDay', String(batch.day));
      window.history.replaceState({}, '', url);
    });
  });
}

setupPositionBatchSwitch();

syncClearButtons();

document.addEventListener('click', () => {
  hideOptionTooltip();
  closeSearchSelects();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeSearchSelects();
  }
});

function formatPickerValue(field) {
  if (!field.value) {
    return field.type === 'month' ? '年/月' : '年/月/日';
  }

  return field.value.replaceAll('-', '/');
}

document.querySelectorAll('input[type="date"], input[type="month"]').forEach((field) => {
  field.classList.add('native-date-input');

  const picker = document.createElement('span');
  picker.className = 'date-picker-shell';
  picker.innerHTML = `
    <button class="date-picker-trigger" type="button" data-date-picker-open>
      <span data-date-picker-label>${formatPickerValue(field)}</span>
    </button>
    <button class="clear-input-button date-picker-clear" type="button" data-date-picker-clear aria-label="清空日期">×</button>
    <button class="date-picker-icon" type="button" data-date-picker-open aria-label="选择日期">▣</button>
  `;
  field.insertAdjacentElement('afterend', picker);

  const label = picker.querySelector('[data-date-picker-label]');
  const openPicker = () => {
    field.focus({ preventScroll: true });
    if (typeof field.showPicker === 'function') {
      try {
        field.showPicker();
        return;
      } catch (error) {
        field.click();
        return;
      }
    }
    field.click();
  };

  picker.querySelectorAll('[data-date-picker-open]').forEach((button) => {
    button.addEventListener('click', openPicker);
  });
  picker.querySelector('[data-date-picker-clear]').addEventListener('click', () => {
    field.value = '';
    label.textContent = formatPickerValue(field);
    field.dispatchEvent(new Event('change', { bubbles: true }));
    syncClearButtons();
  });
  field.addEventListener('change', () => {
    label.textContent = formatPickerValue(field);
    syncClearButtons();
  });
});

syncClearButtons();
