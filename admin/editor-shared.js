/* ─── EDITOR SHARED UTILITIES ──────────────────────────────
   Reusable functions for Troop 79 admin editors:
   file I/O, dynamic lists, localStorage drafts, toasts,
   collapsible sections.
   ──────────────────────────────────────────────────────────── */

// ── File Operations ─────────────────────────────────────────

/**
 * Trigger a browser download of a JSON file.
 * @param {Object} data - The data to serialize.
 * @param {string} filename - The download filename (e.g. "meeting.json").
 */
function downloadJSON(data, filename) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Read a JSON file from a file input element.
 * @param {HTMLInputElement} fileInput - The <input type="file"> element.
 * @returns {Promise<Object>} Parsed JSON data.
 */
function loadJSONFile(fileInput) {
  return new Promise(function(resolve, reject) {
    const file = fileInput.files[0];
    if (!file) {
      reject(new Error('No file selected'));
      return;
    }
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const data = JSON.parse(e.target.result);
        resolve(data);
      } catch (err) {
        reject(new Error('Invalid JSON file: ' + err.message));
      }
    };
    reader.onerror = function() {
      reject(new Error('Failed to read file'));
    };
    reader.readAsText(file);
  });
}

// ── Dynamic List Management ─────────────────────────────────

/**
 * Add a new list item to a container using a template function.
 * @param {HTMLElement} container - The container element for list items.
 * @param {Function} templateFn - A function(index) returning an HTML string.
 */
function addListItem(container, templateFn) {
  const items = container.querySelectorAll('.list-item');
  const index = items.length;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = templateFn(index);
  const newItem = wrapper.firstElementChild;
  container.appendChild(newItem);
  updateListLabels(container);
  return newItem;
}

/**
 * Remove the parent .list-item of the clicked button.
 * @param {HTMLElement} button - The remove button inside a .list-item.
 */
function removeListItem(button) {
  const item = button.closest('.list-item');
  if (!item) return;
  const container = item.parentElement;
  item.remove();
  updateListLabels(container);
}

/**
 * Move a list item up in its container.
 * @param {HTMLElement} button - A button inside the .list-item to move.
 */
function moveItemUp(button) {
  const item = button.closest('.list-item');
  if (!item) return;
  const prev = item.previousElementSibling;
  if (prev && prev.classList.contains('list-item')) {
    item.parentElement.insertBefore(item, prev);
    updateListLabels(item.parentElement);
  }
}

/**
 * Move a list item down in its container.
 * @param {HTMLElement} button - A button inside the .list-item to move.
 */
function moveItemDown(button) {
  const item = button.closest('.list-item');
  if (!item) return;
  const next = item.nextElementSibling;
  if (next && next.classList.contains('list-item')) {
    item.parentElement.insertBefore(next, item);
    updateListLabels(item.parentElement);
  }
}

/**
 * Update numbered labels on list items after reorder/add/remove.
 * Looks for .list-item-label elements and updates the number.
 * @param {HTMLElement} container
 */
function updateListLabels(container) {
  const items = container.querySelectorAll(':scope > .list-item');
  items.forEach(function(item, i) {
    const label = item.querySelector('.list-item-label');
    if (label) {
      const base = label.getAttribute('data-label') || 'Item';
      label.textContent = base + ' ' + (i + 1);
    }
  });
}

// ── Sub-list Helpers ────────────────────────────────────────

/**
 * Add a row to a sub-list container.
 * @param {HTMLElement} container - The .sub-list-items container.
 * @param {Function} templateFn - Returns HTML string for one row.
 */
function addSubListRow(container, templateFn) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = templateFn();
  container.appendChild(wrapper.firstElementChild);
}

/**
 * Remove a sub-list row.
 * @param {HTMLElement} button - The remove button inside the row.
 */
function removeSubListRow(button) {
  const row = button.closest('.sub-list-row, .sub-list-req-row');
  if (row) row.remove();
}

// ── localStorage Draft Management ───────────────────────────

/**
 * Save form data as a draft in localStorage.
 * @param {string} key - The storage key (e.g. "meeting-editor-draft").
 * @param {Object} data - The serialized form data.
 */
function saveDraft(key, data) {
  const payload = {
    data: data,
    timestamp: new Date().toISOString()
  };
  try {
    localStorage.setItem(key, JSON.stringify(payload));
  } catch (e) {
    console.warn('Failed to save draft:', e);
  }
}

/**
 * Load a draft from localStorage.
 * @param {string} key - The storage key.
 * @returns {{ data: Object, timestamp: string }|null}
 */
function loadDraft(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.data && parsed.timestamp) {
      return parsed;
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Clear a draft from localStorage.
 * @param {string} key - The storage key.
 */
function clearDraft(key) {
  localStorage.removeItem(key);
}

// ── Toast Notifications ─────────────────────────────────────

/**
 * Show a toast notification.
 * @param {string} message - The message text.
 * @param {'success'|'error'|'info'} type - The toast type.
 * @param {number} [duration=3000] - How long to show in ms.
 */
function showToast(message, type, duration) {
  type = type || 'info';
  duration = duration || 3000;

  var container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  var toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.textContent = message;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  container.appendChild(toast);

  // Trigger reflow then animate in
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      toast.classList.add('show');
    });
  });

  setTimeout(function() {
    toast.classList.remove('show');
    setTimeout(function() {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }, duration);
}

// ── Collapsible Sections ────────────────────────────────────

/**
 * Initialize all collapsible .form-section elements.
 * Clicking the header toggles the .open class.
 */
function initCollapsibles() {
  document.querySelectorAll('.form-section-header').forEach(function(header) {
    header.addEventListener('click', function() {
      var section = this.closest('.form-section');
      section.classList.toggle('open');
      var expanded = section.classList.contains('open');
      this.setAttribute('aria-expanded', expanded);
    });
  });
}

// ── Login Gate ──────────────────────────────────────────────

/**
 * Initialize the login overlay.
 * Checks sessionStorage for an existing session.
 * @param {Function} onLogin - Callback to run after successful login.
 */
function initLoginGate(onLogin) {
  var overlay = document.getElementById('loginOverlay');
  if (!overlay) return;

  // Already logged in this session
  if (sessionStorage.getItem('admin-auth') === 'true') {
    overlay.classList.add('hidden');
    if (onLogin) onLogin();
    return;
  }

  var form = document.getElementById('loginForm');
  var errorEl = document.getElementById('loginError');

  form.addEventListener('submit', function(e) {
    e.preventDefault();
    var user = document.getElementById('loginUser').value.trim();
    var pass = document.getElementById('loginPass').value.trim();

    if (!user || !pass) {
      errorEl.style.display = 'block';
      errorEl.textContent = 'Please enter both username and password.';
      return;
    }

    // Accept any non-empty credentials (real auth deferred)
    sessionStorage.setItem('admin-auth', 'true');
    overlay.classList.add('hidden');
    if (onLogin) onLogin();
  });
}

/**
 * Sign out: clear session and reload.
 */
function signOut() {
  sessionStorage.removeItem('admin-auth');
  location.reload();
}
