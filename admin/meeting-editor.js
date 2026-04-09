/* ─── MEETING EDITOR ───────────────────────────────────────
   Multi-meeting archive editor for Troop 79.
   Manages an array of meetings in data/meetings.json.
   Depends on: editor-shared.js
   ──────────────────────────────────────────────────────────── */

// ── Config Arrays ───────────────────────────────────────────
const PATROLS = ['Fire Quacker', 'Shooting Star', 'Screaming Eagles', 'Buff Burritos'];
const TRACKS  = ['Open Advancement', 'Merit Badge', 'Event Prep', 'Special'];

const DRAFT_KEY   = 'meeting-editor-archive';
const PREVIEW_KEY = 'meeting-preview';

// ── State ───────────────────────────────────────────────────
let allMeetings = [];    // The full meetings array
let currentIndex = -1;   // Which meeting is being edited (-1 = none/new)
let autosaveInterval = null;

// ── Initialization ──────────────────────────────────────────

function initMeetingEditor() {
  initCollapsibles();
  setupEventListeners();
  loadArchiveFromStorage();
}

function loadArchiveFromStorage() {
  // Check for saved archive in localStorage
  var draft = loadDraft(DRAFT_KEY);
  if (draft && draft.data && Array.isArray(draft.data) && draft.data.length > 0) {
    allMeetings = draft.data;
    showListView();
    return;
  }

  // Otherwise try loading from the data file
  fetch('../data/meetings.json')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (Array.isArray(data)) {
        allMeetings = data;
      } else if (data && data.meeting !== undefined) {
        // Legacy single-meeting format
        allMeetings = [data];
      }
      showListView();
    })
    .catch(function() {
      allMeetings = [];
      showListView();
    });
}

// ── View Switching ──────────────────────────────────────────

function showListView() {
  document.getElementById('listView').classList.remove('hidden');
  document.getElementById('editHeader').style.display = 'none';
  document.querySelector('.editor-body').classList.add('hidden');
  document.querySelector('.actions-bar').classList.add('hidden');
  currentIndex = -1;
  renderMeetingsList();
  stopAutosave();
}

function showEditView(index) {
  currentIndex = index;
  document.getElementById('listView').classList.add('hidden');
  document.getElementById('editHeader').style.display = 'block';
  document.querySelector('.editor-body').classList.remove('hidden');
  document.querySelector('.actions-bar').classList.remove('hidden');

  // Update context label
  var label = document.getElementById('editContextLabel');
  if (index >= 0 && index < allMeetings.length) {
    var m = allMeetings[index];
    var dateStr = getMeetingDate(m);
    label.innerHTML = 'Editing: <strong>' + formatDateNice(dateStr) + '</strong>';
  } else {
    label.innerHTML = '<strong>New Meeting</strong>';
  }

  // Init form and populate
  initForm();
  if (index >= 0 && index < allMeetings.length) {
    populateForm(allMeetings[index]);
  } else {
    resetForm();
  }

  startAutosave();
  window.scrollTo(0, 0);
}

// ── Meetings List Rendering ─────────────────────────────────

function renderMeetingsList() {
  var tbody = document.getElementById('meetingsTableBody');
  tbody.innerHTML = '';

  if (allMeetings.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="meetings-empty">No meetings yet. Click "New Meeting" to create one.</td></tr>';
    return;
  }

  // Sort by date descending (most recent first)
  var sorted = allMeetings
    .map(function(m, i) { return { meeting: m, originalIndex: i }; })
    .sort(function(a, b) {
      var da = getMeetingDate(a.meeting);
      var db = getMeetingDate(b.meeting);
      return db.localeCompare(da);
    });

  sorted.forEach(function(item) {
    var m = item.meeting;
    var idx = item.originalIndex;
    var dateStr = getMeetingDate(m);
    var isNoMeeting = !m.meeting && m.noMeeting;
    var title = isNoMeeting ? (m.noMeeting.reason || 'No Meeting') : getAgendaSummary(m);
    var uniform = m.meeting ? m.meeting.uniform : '';
    var updated = m.meta ? formatDateTimeShort(m.meta.lastUpdated) : '';

    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td class="mtg-date">' + formatDateNice(dateStr) + '</td>' +
      '<td>' +
        (isNoMeeting
          ? '<span class="mtg-badge mtg-badge-no-meeting">No Meeting</span>'
          : '<span class="mtg-badge mtg-badge-meeting">' + esc(uniform) + '</span>') +
      '</td>' +
      '<td>' + esc(title) + '</td>' +
      '<td style="font-size:12px;color:#999;">' + esc(updated) + '</td>' +
      '<td class="mtg-actions">' +
        '<button type="button" data-action="preview" data-index="' + idx + '" title="Preview on meeting page">Preview</button>' +
        '<button type="button" data-action="copy" data-index="' + idx + '" title="Copy as new meeting">Copy</button>' +
        '<button type="button" data-action="edit" data-index="' + idx + '" title="Edit this meeting">Edit</button>' +
        '<button type="button" class="btn-delete" data-action="delete" data-index="' + idx + '" title="Delete this meeting">Delete</button>' +
      '</td>';
    tbody.appendChild(tr);
  });

  // Attach event listeners
  tbody.querySelectorAll('button[data-action]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var action = this.getAttribute('data-action');
      var idx = parseInt(this.getAttribute('data-index'), 10);
      if (action === 'edit') showEditView(idx);
      else if (action === 'copy') copyMeeting(idx);
      else if (action === 'delete') deleteMeeting(idx);
      else if (action === 'preview') previewMeeting(idx);
    });
  });
}

// ── Meeting Actions ─────────────────────────────────────────

function copyMeeting(index) {
  var original = allMeetings[index];
  var copy = JSON.parse(JSON.stringify(original));

  // Bump the date forward 7 days
  var origDate = getMeetingDate(copy);
  if (origDate) {
    var d = new Date(origDate + 'T00:00:00');
    d.setDate(d.getDate() + 7);
    var newDate = d.toISOString().split('T')[0];
    if (copy.meeting) copy.meeting.date = newDate;
    if (copy.noMeeting) copy.noMeeting.date = newDate;
  }

  copy.meta = copy.meta || {};
  copy.meta.lastUpdated = new Date().toISOString();
  copy.meta.source = '';

  allMeetings.push(copy);
  saveArchive();
  var newIdx = allMeetings.length - 1;
  showEditView(newIdx);
  showToast('Meeting copied. Update the details and save.', 'success');
}

function deleteMeeting(index) {
  var dateStr = getMeetingDate(allMeetings[index]);
  if (!confirm('Delete the meeting for ' + formatDateNice(dateStr) + '? This cannot be undone.')) return;
  allMeetings.splice(index, 1);
  saveArchive();
  renderMeetingsList();
  showToast('Meeting deleted', 'info');
}

function previewMeeting(index) {
  var data = allMeetings[index];
  localStorage.setItem(PREVIEW_KEY, JSON.stringify(data));
  window.open('../meeting.html?preview=true', '_blank');
  showToast('Preview opened in new tab', 'info');
}

// ── Form Initialization ─────────────────────────────────────

function initForm() {
  // Populate patrol dropdowns
  var patrolSelects = document.querySelectorAll('.patrol-select');
  patrolSelects.forEach(function(sel) {
    // Keep the first option, clear the rest
    while (sel.options.length > 1) sel.remove(1);
    PATROLS.forEach(function(name) {
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
  });
}

function resetForm() {
  // Clear all fields to defaults
  document.getElementById('noMeetingToggle').checked = false;
  handleNoMeetingToggle();

  setVal('meetingDate', '');
  setVal('meetingTime', '4:00 - 5:30 PM');
  setVal('meetingUniform', 'Class B');
  setVal('meetingLocation', 'Northwoods');
  setVal('meetingLocationAddress', '1572 E Capitol Drive, Milwaukee, WI');
  setVal('meetingSnack', '');
  setVal('meetingFlagCeremony', '');
  setVal('meetingCleanup', '');
  setVal('meetingDutyRosterUrl', '');
  setVal('metaUpdatedBy', 'Patrick B.');
  setVal('metaSource', '');

  clearList(document.getElementById('preMeetingList'));
  clearList(document.getElementById('announcementsList'));
  clearList(document.getElementById('lookAheadList'));

  var agendaList = document.getElementById('agendaList');
  clearList(agendaList);
  var el = addListItem(agendaList, agendaItemTemplate);
  populateTrackSelect(el);

  for (var i = 0; i < 3; i++) {
    addListItem(document.getElementById('lookAheadList'), lookAheadTemplate);
  }

  setVal('bugleHeaderImage', '');
  setVal('bugleIntroText', '');
  setVal('bugleClosingText', '');
  setVal('bugleEditorNotes', '');

  setVal('noMeetingDate', '');
  setVal('noMeetingReason', '');
  setVal('noMeetingNextDate', '');
  setVal('noMeetingMessage', '');
  setVal('metaUpdatedByNm', '');
  setVal('metaSourceNm', '');
}

function populateTrackSelect(container) {
  container.querySelectorAll('.track-select').forEach(function(sel) {
    if (sel.options.length > 1) return;
    TRACKS.forEach(function(name) {
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
  });
}

// ── Event Listeners ─────────────────────────────────────────

function setupEventListeners() {
  // No-meeting toggle
  var toggle = document.getElementById('noMeetingToggle');
  if (toggle) toggle.addEventListener('change', handleNoMeetingToggle);

  // Action bar buttons
  document.getElementById('btnSaveDraft').addEventListener('click', handleSaveAndReturn);
  document.getElementById('btnLoadFile').addEventListener('click', function() {
    document.getElementById('fileInput').click();
  });
  document.getElementById('fileInput').addEventListener('change', handleLoadSingleFile);
  document.getElementById('btnPreview').addEventListener('click', handlePreviewCurrent);
  document.getElementById('btnCopyJSON').addEventListener('click', handleCopyCurrent);
  document.getElementById('btnDownload').addEventListener('click', handleExportAll);

  // List view buttons
  document.getElementById('btnNewMeeting').addEventListener('click', function() {
    allMeetings.push(null); // placeholder
    showEditView(allMeetings.length - 1);
    allMeetings.pop(); // remove placeholder — will be added on save
    currentIndex = -1; // mark as new
  });
  document.getElementById('btnBackToList').addEventListener('click', function() {
    showListView();
  });
  document.getElementById('btnExportAll').addEventListener('click', handleExportAll);
  document.getElementById('btnLoadArchive').addEventListener('click', function() {
    document.getElementById('archiveFileInput').click();
  });
  document.getElementById('archiveFileInput').addEventListener('change', function() {
    var fileInput = document.getElementById('archiveFileInput');
    loadJSONFile(fileInput).then(function(data) {
      if (Array.isArray(data)) {
        allMeetings = data;
      } else if (data && data.meeting !== undefined) {
        allMeetings = [data];
      }
      saveArchive();
      renderMeetingsList();
      showToast('Archive loaded: ' + allMeetings.length + ' meeting(s)', 'success');
    }).catch(function(err) {
      showToast(err.message, 'error');
    }).finally(function() {
      fileInput.value = '';
    });
  });

  // Sign out
  var signOutBtn = document.getElementById('btnSignOut');
  if (signOutBtn) {
    signOutBtn.addEventListener('click', function(e) {
      e.preventDefault();
      signOut();
    });
  }
}

// ── No-Meeting Toggle ───────────────────────────────────────

function handleNoMeetingToggle() {
  var section = document.getElementById('meetingDetailsSection');
  var checked = document.getElementById('noMeetingToggle').checked;
  if (checked) {
    section.classList.add('no-meeting-active');
  } else {
    section.classList.remove('no-meeting-active');
  }
}

// ── Populate Form from Data ─────────────────────────────────

function populateForm(data) {
  if (!data) { resetForm(); return; }

  var toggle = document.getElementById('noMeetingToggle');
  toggle.checked = false;
  document.getElementById('meetingDetailsSection').classList.remove('no-meeting-active');

  if (data.noMeeting && !data.meeting) {
    toggle.checked = true;
    handleNoMeetingToggle();
    setVal('noMeetingDate', data.noMeeting.date || '');
    setVal('noMeetingReason', data.noMeeting.reason || '');
    setVal('noMeetingNextDate', data.noMeeting.nextMeetingDate || '');
    setVal('noMeetingMessage', data.noMeeting.message || '');
  }

  if (data.meeting) {
    setVal('meetingDate', data.meeting.date || '');
    setVal('meetingTime', data.meeting.time || '');
    setVal('meetingUniform', data.meeting.uniform || '');
    setVal('meetingLocation', data.meeting.location || '');
    setVal('meetingLocationAddress', data.meeting.locationAddress || '');
    setVal('meetingSnack', data.meeting.snack || '');
    setVal('meetingFlagCeremony', data.meeting.flagCeremony || '');
    setVal('meetingCleanup', data.meeting.cleanup || '');
    setVal('meetingDutyRosterUrl', data.meeting.dutyRosterUrl || '');
  }

  // Pre-meeting
  var preMeetingList = document.getElementById('preMeetingList');
  clearList(preMeetingList);
  if (data.preMeeting && data.preMeeting.length > 0) {
    data.preMeeting.forEach(function(item) {
      var el = addListItem(preMeetingList, preMeetingTemplate);
      el.querySelector('.pm-time').value = item.time || '';
      el.querySelector('.pm-title').value = item.title || '';
      el.querySelector('.pm-description').value = item.description || '';
      if (item.contact) {
        el.querySelector('.pm-contact-name').value = item.contact.name || '';
        el.querySelector('.pm-contact-phone').value = item.contact.phone || '';
      }
    });
  }

  // Agenda
  var agendaList = document.getElementById('agendaList');
  clearList(agendaList);
  if (data.agenda && data.agenda.length > 0) {
    data.agenda.forEach(function(item) {
      var el = addListItem(agendaList, agendaItemTemplate);
      populateTrackSelect(el);
      el.querySelector('.ag-time').value = item.time || '';
      el.querySelector('.ag-title').value = item.title || '';
      el.querySelector('.ag-description').value = item.description || '';
      el.querySelector('.ag-track').value = item.track || '';
      el.querySelector('.ag-leader').value = item.leader || '';
      el.querySelector('.ag-resource-url').value = item.resourceUrl || '';

      if (item.scouts && item.scouts.length > 0) {
        var scoutsContainer = el.querySelector('.scouts-list');
        item.scouts.forEach(function(name) {
          addSubListRow(scoutsContainer, scoutRowTemplate);
          var rows = scoutsContainer.querySelectorAll('.sub-list-row');
          rows[rows.length - 1].querySelector('input').value = name;
        });
      }

      if (item.requirements && item.requirements.length > 0) {
        var reqContainer = el.querySelector('.requirements-list');
        item.requirements.forEach(function(req) {
          addSubListRow(reqContainer, requirementRowTemplate);
          var rows = reqContainer.querySelectorAll('.sub-list-req-row');
          var lastRow = rows[rows.length - 1];
          lastRow.querySelector('.req-id-input').value = req.id || '';
          lastRow.querySelector('.req-text-input').value = req.text || '';
          lastRow.querySelector('.req-source-input').value = req.source || '';
        });
      }
    });
  } else {
    var el = addListItem(agendaList, agendaItemTemplate);
    populateTrackSelect(el);
  }

  // Announcements
  var annList = document.getElementById('announcementsList');
  clearList(annList);
  if (data.announcements && data.announcements.length > 0) {
    data.announcements.forEach(function(item) {
      var el = addListItem(annList, announcementTemplate);
      el.querySelector('.ann-title').value = item.title || '';
      el.querySelector('.ann-body').value = item.body || '';
      el.querySelector('.ann-priority').value = item.priority || 'normal';
      el.querySelector('.ann-link-label').value = item.linkLabel || '';
      el.querySelector('.ann-link-url').value = item.linkUrl || '';
    });
  }

  // Looking Ahead
  var lookList = document.getElementById('lookAheadList');
  clearList(lookList);
  if (data.lookAhead && data.lookAhead.length > 0) {
    data.lookAhead.forEach(function(item) {
      var el = addListItem(lookList, lookAheadTemplate);
      el.querySelector('.la-date').value = item.date || '';
      el.querySelector('.la-title').value = item.title || '';
      el.querySelector('.la-note').value = item.note || '';
    });
  } else {
    for (var i = 0; i < 3; i++) addListItem(lookList, lookAheadTemplate);
  }

  // Bugle settings
  if (data.bugle) {
    setVal('bugleHeaderImage', data.bugle.headerImageUrl || '');
    setVal('bugleIntroText', data.bugle.introText || '');
    setVal('bugleClosingText', data.bugle.closingText || '');
    setVal('bugleEditorNotes', data.bugle.editorNotes || '');
  }

  // Meta
  if (data.meta) {
    setVal('metaUpdatedBy', data.meta.updatedBy || '');
    setVal('metaSource', data.meta.source || '');
  }
}

// ── Serialize Form ──────────────────────────────────────────

function serializeForm() {
  var isNoMeeting = document.getElementById('noMeetingToggle').checked;
  var data = {};

  var updatedBy = isNoMeeting
    ? (getVal('metaUpdatedByNm') || getVal('metaUpdatedBy') || 'Patrick B.')
    : (getVal('metaUpdatedBy') || 'Patrick B.');
  var source = isNoMeeting
    ? (getVal('metaSourceNm') || getVal('metaSource') || '')
    : (getVal('metaSource') || '');
  data.meta = {
    lastUpdated: new Date().toISOString(),
    updatedBy: updatedBy,
    source: source
  };

  if (isNoMeeting) {
    data.meeting = null;
    data.noMeeting = {
      date: getVal('noMeetingDate'),
      reason: getVal('noMeetingReason'),
      nextMeetingDate: getVal('noMeetingNextDate'),
      message: getVal('noMeetingMessage')
    };
  } else {
    data.meeting = {
      date: getVal('meetingDate'),
      time: getVal('meetingTime'),
      uniform: getVal('meetingUniform'),
      location: getVal('meetingLocation'),
      locationAddress: getVal('meetingLocationAddress'),
      snack: getVal('meetingSnack'),
      flagCeremony: getVal('meetingFlagCeremony'),
      cleanup: getVal('meetingCleanup'),
      dutyRosterUrl: getVal('meetingDutyRosterUrl')
    };
    data.noMeeting = null;
  }

  // Pre-meeting
  data.preMeeting = [];
  document.querySelectorAll('#preMeetingList > .list-item').forEach(function(el) {
    var item = {
      time: el.querySelector('.pm-time').value.trim(),
      title: el.querySelector('.pm-title').value.trim(),
      description: el.querySelector('.pm-description').value.trim()
    };
    var cName = el.querySelector('.pm-contact-name').value.trim();
    var cPhone = el.querySelector('.pm-contact-phone').value.trim();
    if (cName || cPhone) item.contact = { name: cName, phone: cPhone };
    if (item.title || item.description) data.preMeeting.push(item);
  });

  // Agenda
  data.agenda = [];
  document.querySelectorAll('#agendaList > .list-item').forEach(function(el) {
    var item = {
      time: el.querySelector('.ag-time').value.trim(),
      title: el.querySelector('.ag-title').value.trim(),
      description: el.querySelector('.ag-description').value.trim(),
      track: el.querySelector('.ag-track').value || null,
      leader: el.querySelector('.ag-leader').value.trim() || null
    };
    var scouts = [];
    el.querySelectorAll('.scouts-list .sub-list-row input').forEach(function(inp) {
      var v = inp.value.trim();
      if (v) scouts.push(v);
    });
    if (scouts.length > 0) item.scouts = scouts;
    var reqs = [];
    el.querySelectorAll('.requirements-list .sub-list-req-row').forEach(function(row) {
      var req = {
        id: row.querySelector('.req-id-input').value.trim(),
        text: row.querySelector('.req-text-input').value.trim(),
        source: row.querySelector('.req-source-input').value.trim()
      };
      if (req.id || req.text) reqs.push(req);
    });
    if (reqs.length > 0) item.requirements = reqs;
    var resUrl = el.querySelector('.ag-resource-url').value.trim();
    if (resUrl) item.resourceUrl = resUrl;
    if (item.title || item.description) data.agenda.push(item);
  });

  // Announcements
  data.announcements = [];
  document.querySelectorAll('#announcementsList > .list-item').forEach(function(el) {
    var item = {
      title: el.querySelector('.ann-title').value.trim(),
      body: el.querySelector('.ann-body').value.trim(),
      priority: el.querySelector('.ann-priority').value || 'normal'
    };
    var ll = el.querySelector('.ann-link-label').value.trim();
    var lu = el.querySelector('.ann-link-url').value.trim();
    if (ll) item.linkLabel = ll;
    if (lu) item.linkUrl = lu;
    if (item.title || item.body) data.announcements.push(item);
  });

  // Looking Ahead
  data.lookAhead = [];
  document.querySelectorAll('#lookAheadList > .list-item').forEach(function(el) {
    var item = {
      date: el.querySelector('.la-date').value,
      title: el.querySelector('.la-title').value.trim(),
      note: el.querySelector('.la-note').value.trim()
    };
    if (item.date || item.title) data.lookAhead.push(item);
  });

  // Bugle
  var bh = getVal('bugleHeaderImage'), bi = getVal('bugleIntroText');
  var bc = getVal('bugleClosingText'), bn = getVal('bugleEditorNotes');
  if (bh || bi || bc || bn) {
    data.bugle = { headerImageUrl: bh, introText: bi, closingText: bc, editorNotes: bn };
  }

  return data;
}

// ── Action Handlers ─────────────────────────────────────────

function handleSaveAndReturn() {
  var data = serializeForm();
  if (currentIndex >= 0 && currentIndex < allMeetings.length) {
    allMeetings[currentIndex] = data;
  } else {
    allMeetings.push(data);
  }
  saveArchive();
  showToast('Meeting saved', 'success');
  showListView();
}

function handlePreviewCurrent() {
  var data = serializeForm();
  localStorage.setItem(PREVIEW_KEY, JSON.stringify(data));
  window.open('../meeting.html?preview=true', '_blank');
  showToast('Preview opened in new tab', 'info');
}

function handleCopyCurrent() {
  var data = serializeForm();
  var json = JSON.stringify(data, null, 2);
  navigator.clipboard.writeText(json).then(function() {
    showToast('Meeting JSON copied to clipboard', 'success');
  }).catch(function() {
    showToast('Failed to copy', 'error');
  });
}

function handleExportAll() {
  // Make sure any in-progress edit is captured
  if (currentIndex >= 0) {
    allMeetings[currentIndex] = serializeForm();
  }
  downloadJSON(allMeetings, 'meetings.json');
  showToast('meetings.json downloaded (' + allMeetings.length + ' meetings)', 'success');
}

function handleLoadSingleFile() {
  var fileInput = document.getElementById('fileInput');
  loadJSONFile(fileInput).then(function(data) {
    populateForm(data);
    showToast('Meeting data loaded into form', 'success');
  }).catch(function(err) {
    showToast(err.message, 'error');
  }).finally(function() {
    fileInput.value = '';
  });
}

// ── Archive Persistence ─────────────────────────────────────

function saveArchive() {
  saveDraft(DRAFT_KEY, allMeetings);
}

function startAutosave() {
  stopAutosave();
  autosaveInterval = setInterval(function() {
    if (currentIndex >= 0 && currentIndex < allMeetings.length) {
      allMeetings[currentIndex] = serializeForm();
    }
    saveArchive();
    var now = new Date();
    var ts = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    var el = document.getElementById('autosaveStatus');
    if (el) {
      el.textContent = 'Auto-saved at ' + ts;
      el.classList.add('saved');
      setTimeout(function() { el.classList.remove('saved'); }, 3000);
    }
  }, 30000);
}

function stopAutosave() {
  if (autosaveInterval) {
    clearInterval(autosaveInterval);
    autosaveInterval = null;
  }
}

// ── Helpers ─────────────────────────────────────────────────

function getMeetingDate(m) {
  if (m.meeting && m.meeting.date) return m.meeting.date;
  if (m.noMeeting && m.noMeeting.date) return m.noMeeting.date;
  return '';
}

function getAgendaSummary(m) {
  if (!m.agenda || m.agenda.length === 0) return '(no agenda)';
  var titles = m.agenda.slice(0, 3).map(function(a) { return a.title; }).filter(Boolean);
  var summary = titles.join(', ');
  if (m.agenda.length > 3) summary += ' +' + (m.agenda.length - 3) + ' more';
  return summary;
}

function formatDateNice(dateStr) {
  if (!dateStr) return '(no date)';
  var d = new Date(dateStr + 'T00:00:00');
  var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return days[d.getDay()] + ', ' + months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}

function formatDateTimeShort(isoStr) {
  if (!isoStr) return '';
  var d = new Date(isoStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
         d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function esc(str) {
  if (!str) return '';
  var div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

function getVal(id) {
  var el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

function setVal(id, value) {
  var el = document.getElementById(id);
  if (el) el.value = value;
}

function clearList(container) {
  container.innerHTML = '';
}

// ── Template Functions ──────────────────────────────────────

function preMeetingTemplate(index) {
  return '<div class="list-item"><div class="list-item-header"><span class="list-item-label" data-label="Activity">Activity ' + (index + 1) + '</span><div class="list-item-controls"><button type="button" class="btn-remove-item" onclick="removeListItem(this)" title="Remove">Remove</button></div></div><div class="form-row"><div class="form-group"><label>Time</label><input type="text" class="pm-time" placeholder="e.g. 1:30 PM"></div><div class="form-group"><label>Title</label><input type="text" class="pm-title" placeholder="Activity title"></div></div><div class="form-group"><label>Description</label><textarea class="pm-description" rows="2" placeholder="What is this activity about?"></textarea></div><div class="form-row"><div class="form-group"><label>Contact Name <span class="optional">optional</span></label><input type="text" class="pm-contact-name" placeholder="Name"></div><div class="form-group"><label>Contact Phone <span class="optional">optional</span></label><input type="text" class="pm-contact-phone" placeholder="414-555-0000"></div></div></div>';
}

function agendaItemTemplate(index) {
  return '<div class="list-item"><div class="list-item-header"><span class="list-item-label" data-label="Agenda Item">Agenda Item ' + (index + 1) + '</span><div class="list-item-controls"><button type="button" onclick="moveItemUp(this)" title="Move up">&#9650;</button><button type="button" onclick="moveItemDown(this)" title="Move down">&#9660;</button><button type="button" class="btn-remove-item" onclick="removeListItem(this)" title="Remove">Remove</button></div></div><div class="form-row"><div class="form-group"><label>Time</label><input type="text" class="ag-time" placeholder="e.g. 4:00"></div><div class="form-group"><label>Title</label><input type="text" class="ag-title" placeholder="Agenda item title"></div></div><div class="form-group"><label>Description</label><textarea class="ag-description" rows="2" placeholder="What happens during this item?"></textarea></div><div class="form-row"><div class="form-group"><label>Track</label><select class="ag-track track-select"><option value="">-- None --</option></select></div><div class="form-group"><label>Leader <span class="optional">optional</span></label><input type="text" class="ag-leader" placeholder="Leader name"></div></div><div class="sub-list"><div class="sub-list-label">Scouts</div><div class="sub-list-items scouts-list"></div><button type="button" class="btn-add-sub" onclick="addSubListRow(this.previousElementSibling, scoutRowTemplate)">+ Add Scout</button></div><div class="sub-list" style="margin-top:12px"><div class="sub-list-label">Requirements</div><div class="sub-list-items requirements-list"></div><button type="button" class="btn-add-sub" onclick="addSubListRow(this.previousElementSibling, requirementRowTemplate)">+ Add Requirement</button></div><div class="form-group" style="margin-top:12px"><label>Resource URL <span class="optional">optional</span></label><input type="text" class="ag-resource-url" placeholder="https://..."></div></div>';
}

function scoutRowTemplate() {
  return '<div class="sub-list-row"><input type="text" placeholder="Scout name (e.g. Finn P.)"><button type="button" class="btn-remove-sub" onclick="removeSubListRow(this)" title="Remove">&times;</button></div>';
}

function requirementRowTemplate() {
  return '<div class="sub-list-req-row"><div class="form-group"><label>Req ID</label><input type="text" class="req-id-input" placeholder="e.g. 7"></div><div class="req-fields"><div class="form-group"><label>Full Text</label><textarea class="req-text-input" rows="2" placeholder="Requirement text"></textarea></div><div class="form-group"><label>Source</label><input type="text" class="req-source-input" placeholder="e.g. Citizenship in the World MB, Requirement 7"></div></div><button type="button" class="btn-remove-sub" onclick="removeSubListRow(this)" title="Remove">&times;</button></div>';
}

function announcementTemplate(index) {
  return '<div class="list-item"><div class="list-item-header"><span class="list-item-label" data-label="Announcement">Announcement ' + (index + 1) + '</span><div class="list-item-controls"><button type="button" class="btn-remove-item" onclick="removeListItem(this)" title="Remove">Remove</button></div></div><div class="form-row"><div class="form-group"><label>Title</label><input type="text" class="ann-title" placeholder="Announcement title"></div><div class="form-group"><label>Priority</label><select class="ann-priority"><option value="normal">Normal</option><option value="high">High</option></select></div></div><div class="form-group"><label>Body</label><textarea class="ann-body" rows="2" placeholder="Announcement details"></textarea></div><div class="form-row"><div class="form-group"><label>Link Label <span class="optional">optional</span></label><input type="text" class="ann-link-label" placeholder="Learn more"></div><div class="form-group"><label>Link URL <span class="optional">optional</span></label><input type="text" class="ann-link-url" placeholder="https://..."></div></div></div>';
}

function lookAheadTemplate(index) {
  return '<div class="list-item"><div class="list-item-header"><span class="list-item-label" data-label="Event">Event ' + (index + 1) + '</span><div class="list-item-controls"><button type="button" class="btn-remove-item" onclick="removeListItem(this)" title="Remove">Remove</button></div></div><div class="form-row"><div class="form-group"><label>Date</label><input type="date" class="la-date"></div><div class="form-group"><label>Title</label><input type="text" class="la-title" placeholder="Event title"></div><div class="form-group"><label>Note</label><input type="text" class="la-note" placeholder="Brief note"></div></div></div>';
}
