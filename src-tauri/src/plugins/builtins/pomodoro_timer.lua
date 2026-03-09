--[[ [manifest]
id = "nous.builtin.pomodoro-timer"
name = "Pomodoro Timer"
version = "0.2.0"
description = "Sidebar panel Pomodoro timer with session logging to a database, sound alerts, and configurable durations."
capabilities = ["sidebar_panel", "database_read", "database_write"]
hooks = ["sidebar_panel:pomodoro"]
is_builtin = true
]]

-- Persistent timer state (survives across render_panel calls within app session)
_pomo_state = _pomo_state or {
  mode = "work",
  timeRemaining = 1500,
  isRunning = false,
  sessionsCompleted = 0,
  todaySessions = 0,
  todayDate = "",
  workDuration = 25,
  breakDuration = 5,
  longBreakDuration = 15,
  sessionsBeforeLongBreak = 4,
  soundEnabled = true,
}

-- Cache the database ID once found/created
_pomo_db_id = _pomo_db_id or nil

function describe_panel(_input_json)
  return nous.json_encode({
    panel_id = "pomodoro",
    label = "Pomodoro",
    icon_svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    default_width = 280,
  })
end

function find_or_create_pomo_db(notebook_id)
  if _pomo_db_id then return _pomo_db_id end
  if not notebook_id or notebook_id == "" then return nil end

  -- Search existing databases
  local ok, list_json = pcall(function() return nous.database_list(notebook_id) end)
  if ok and list_json then
    local dbs = nous.json_decode(list_json)
    for _, db in ipairs(dbs) do
      if db.title == "Pomodoro Log" then
        _pomo_db_id = db.id
        return _pomo_db_id
      end
    end
  end

  -- Create new database
  local props = nous.json_encode({
    { name = "Date", type = "text" },
    { name = "Time", type = "text" },
    { name = "Mode", type = "text" },
    { name = "Duration (min)", type = "number" },
  })
  local ok2, result_json = pcall(function() return nous.database_create(notebook_id, "Pomodoro Log", props) end)
  if ok2 and result_json then
    local result = nous.json_decode(result_json)
    _pomo_db_id = result.id
    return _pomo_db_id
  end

  return nil
end

function render_panel(input_json)
  local input = nous.json_decode(input_json)
  local ctx = input.context or {}
  local notebook_id = ctx.current_notebook_id or ""
  local s = _pomo_state

  -- Reset today's sessions if date changed
  local today = nous.current_date().iso
  if s.todayDate ~= today then
    s.todaySessions = 0
    s.todayDate = today
  end

  local html = string.format([[
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: transparent;
    color: #c8c8d8;
    padding: 16px;
    user-select: none;
  }
  .timer-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
  }
  .mode-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    transition: color 0.3s;
  }
  .arc-container {
    position: relative;
    width: 160px;
    height: 160px;
  }
  .arc-container svg { transform: rotate(-90deg); }
  .time-display {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .time-text {
    font-size: 32px;
    font-weight: 700;
    color: #e0e0f0;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.5px;
  }
  .mode-text {
    font-size: 11px;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-top: 2px;
  }
  .session-dots {
    display: flex;
    gap: 6px;
    justify-content: center;
  }
  .session-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%%;
    transition: background-color 0.3s;
  }
  .controls {
    display: flex;
    gap: 8px;
    justify-content: center;
  }
  .btn {
    padding: 6px 18px;
    font-size: 12px;
    font-weight: 500;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .btn:hover { opacity: 0.85; }
  .btn-primary { background: #6366f1; color: #fff; }
  .btn-secondary { background: rgba(255,255,255,0.08); color: #ccc; border: 1px solid rgba(255,255,255,0.1); }
  .btn-skip { background: transparent; color: #888; border: 1px solid rgba(255,255,255,0.08); padding: 6px 12px; }
  .today-count {
    font-size: 11px;
    color: #666;
    text-align: center;
  }
  .settings-toggle {
    font-size: 11px;
    color: #666;
    cursor: pointer;
    text-align: center;
    user-select: none;
    padding: 4px;
  }
  .settings-toggle:hover { color: #999; }
  .settings-panel {
    display: none;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    background: rgba(255,255,255,0.03);
    border-radius: 8px;
    margin-top: 4px;
  }
  .settings-panel.open { display: flex; }
  .setting-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
    color: #aaa;
  }
  .setting-row input[type="number"] {
    width: 52px;
    background: rgba(255,255,255,0.06);
    color: #e0e0e0;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 4px;
    padding: 3px 6px;
    font-size: 12px;
    text-align: center;
  }
  .sound-toggle {
    width: 36px;
    height: 20px;
    border-radius: 10px;
    background: rgba(255,255,255,0.1);
    border: none;
    cursor: pointer;
    position: relative;
    transition: background 0.2s;
  }
  .sound-toggle.on { background: #6366f1; }
  .sound-toggle::after {
    content: "";
    position: absolute;
    width: 16px;
    height: 16px;
    border-radius: 50%%;
    background: #fff;
    top: 2px;
    left: 2px;
    transition: transform 0.2s;
  }
  .sound-toggle.on::after { transform: translateX(16px); }
</style>

<div class="timer-wrap">
  <div id="mode-label" class="mode-label">work</div>

  <div class="arc-container">
    <svg width="160" height="160" viewBox="0 0 160 160">
      <circle cx="80" cy="80" r="70" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="8"/>
      <circle id="arc" cx="80" cy="80" r="70" fill="none" stroke-width="8" stroke-linecap="round"
        stroke-dasharray="439.82" stroke-dashoffset="0"
        style="transition:stroke-dashoffset 0.8s linear;"/>
    </svg>
    <div class="time-display">
      <div id="time-text" class="time-text">--:--</div>
      <div id="mode-text" class="mode-text">work</div>
    </div>
  </div>

  <div id="session-dots" class="session-dots"></div>

  <div class="controls">
    <button id="btn-start" class="btn btn-primary">Start</button>
    <button id="btn-pause" class="btn btn-secondary" style="display:none;">Pause</button>
    <button id="btn-resume" class="btn btn-primary" style="display:none;">Resume</button>
    <button id="btn-skip" class="btn btn-skip">Skip</button>
  </div>

  <div id="today-count" class="today-count"></div>

  <div id="settings-toggle" class="settings-toggle">Settings</div>
  <div id="settings-panel" class="settings-panel">
    <div class="setting-row">
      <span>Work (min)</span>
      <input id="set-work" type="number" min="1" max="120" value="%d"/>
    </div>
    <div class="setting-row">
      <span>Break (min)</span>
      <input id="set-break" type="number" min="1" max="60" value="%d"/>
    </div>
    <div class="setting-row">
      <span>Long break (min)</span>
      <input id="set-longbreak" type="number" min="1" max="60" value="%d"/>
    </div>
    <div class="setting-row">
      <span>Sessions</span>
      <input id="set-sbl" type="number" min="1" max="10" value="%d"/>
    </div>
    <div class="setting-row">
      <span>Sound</span>
      <button id="sound-toggle" class="sound-toggle %s"></button>
    </div>
  </div>
</div>

<script>
(function() {
  var NOTEBOOK_ID = '%s';
  var circumference = 2 * Math.PI * 70;
  var modeColors = { work: '#6366f1', shortBreak: '#22c55e', longBreak: '#3b82f6' };
  var modeLabels = { work: 'Work', shortBreak: 'Break', longBreak: 'Long Break' };

  var state = {
    mode: '%s',
    timeRemaining: %d,
    isRunning: %s,
    sessionsCompleted: %d,
    todaySessions: %d,
    workDuration: %d,
    breakDuration: %d,
    longBreakDuration: %d,
    sessionsBeforeLongBreak: %d,
    soundEnabled: %s
  };

  var interval = null;
  var arc = document.getElementById('arc');
  var timeText = document.getElementById('time-text');
  var modeText = document.getElementById('mode-text');
  var modeLabel = document.getElementById('mode-label');
  var dotsEl = document.getElementById('session-dots');
  var todayEl = document.getElementById('today-count');
  var btnStart = document.getElementById('btn-start');
  var btnPause = document.getElementById('btn-pause');
  var btnResume = document.getElementById('btn-resume');

  function getTotalSeconds() {
    if (state.mode === 'work') return state.workDuration * 60;
    if (state.mode === 'longBreak') return state.longBreakDuration * 60;
    return state.breakDuration * 60;
  }

  function fmt(n) { return String(Math.floor(n)).padStart(2, '0'); }

  function updateDisplay() {
    var mins = Math.floor(state.timeRemaining / 60);
    var secs = state.timeRemaining %% 60;
    timeText.textContent = fmt(mins) + ':' + fmt(secs);
    var label = modeLabels[state.mode] || 'Work';
    modeText.textContent = label;
    modeLabel.textContent = label;
    modeLabel.style.color = modeColors[state.mode] || modeColors.work;

    var total = getTotalSeconds();
    var progress = total > 0 ? state.timeRemaining / total : 0;
    arc.setAttribute('stroke-dashoffset', circumference * (1 - progress));
    arc.setAttribute('stroke', modeColors[state.mode] || modeColors.work);

    btnStart.style.display = (!state.isRunning) ? '' : 'none';
    btnPause.style.display = (state.isRunning) ? '' : 'none';
    btnResume.style.display = 'none';

    // Session dots
    var html = '';
    for (var i = 0; i < state.sessionsBeforeLongBreak; i++) {
      var filled = i < (state.sessionsCompleted %% state.sessionsBeforeLongBreak);
      html += '<div class="session-dot" style="background:' +
        (filled ? (modeColors[state.mode] || modeColors.work) : 'rgba(255,255,255,0.08)') +
        ';"></div>';
    }
    dotsEl.innerHTML = html;

    // Today count
    if (state.todaySessions > 0) {
      todayEl.textContent = state.todaySessions + ' session' + (state.todaySessions !== 1 ? 's' : '') + ' today';
    } else {
      todayEl.textContent = '';
    }
  }

  function saveState() {
    window.parent.postMessage({
      type: 'plugin-panel-action',
      payload: {
        action: 'save_state',
        mode: state.mode,
        timeRemaining: state.timeRemaining,
        isRunning: state.isRunning,
        sessionsCompleted: state.sessionsCompleted,
        todaySessions: state.todaySessions,
        workDuration: state.workDuration,
        breakDuration: state.breakDuration,
        longBreakDuration: state.longBreakDuration,
        sessionsBeforeLongBreak: state.sessionsBeforeLongBreak,
        soundEnabled: state.soundEnabled
      }
    }, '*');
  }

  function logSession(mode, duration) {
    window.parent.postMessage({
      type: 'plugin-panel-action',
      payload: {
        action: 'log_session',
        notebookId: NOTEBOOK_ID,
        mode: mode,
        duration: duration
      }
    }, '*');
  }

  function playBeep() {
    if (!state.soundEnabled) return;
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      // Two-tone chime
      function tone(freq, start, dur) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.25, ctx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + start + dur);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + dur);
      }
      tone(880, 0, 0.15);
      tone(1100, 0.18, 0.25);
    } catch(e) {}
  }

  function sendNotification(title, body) {
    window.parent.postMessage({
      type: 'plugin-panel-notification',
      title: title,
      body: body
    }, '*');
  }

  function startTimer() {
    state.isRunning = true;
    interval = setInterval(tick, 1000);
    updateDisplay();
    saveState();
  }

  function pauseTimer() {
    state.isRunning = false;
    clearInterval(interval);
    interval = null;
    btnStart.style.display = 'none';
    btnPause.style.display = 'none';
    btnResume.style.display = '';
    saveState();
  }

  function resumeTimer() {
    startTimer();
  }

  function skipTimer() {
    clearInterval(interval);
    interval = null;
    state.isRunning = false;
    transitionMode();
    updateDisplay();
    saveState();
  }

  function transitionMode() {
    if (state.mode === 'work') {
      state.sessionsCompleted++;
      state.todaySessions++;
      if (state.sessionsCompleted %% state.sessionsBeforeLongBreak === 0) {
        state.mode = 'longBreak';
        state.timeRemaining = state.longBreakDuration * 60;
      } else {
        state.mode = 'shortBreak';
        state.timeRemaining = state.breakDuration * 60;
      }
    } else {
      state.mode = 'work';
      state.timeRemaining = state.workDuration * 60;
    }
  }

  function tick() {
    if (state.timeRemaining > 0) {
      state.timeRemaining--;
      updateDisplay();
      // Save state every 30s to avoid excessive IPC
      if (state.timeRemaining %% 30 === 0) saveState();
    } else {
      // Session complete
      clearInterval(interval);
      interval = null;
      state.isRunning = false;

      var prevMode = state.mode;
      var duration = 0;
      if (prevMode === 'work') duration = state.workDuration;
      else if (prevMode === 'longBreak') duration = state.longBreakDuration;
      else duration = state.breakDuration;

      playBeep();

      if (prevMode === 'work') {
        sendNotification('Pomodoro', 'Work session complete! Time for a break.');
        logSession('work', state.workDuration);
      } else {
        sendNotification('Pomodoro', 'Break is over. Ready to focus?');
      }

      transitionMode();
      updateDisplay();
      saveState();
    }
  }

  // Button handlers
  btnStart.addEventListener('click', startTimer);
  btnPause.addEventListener('click', pauseTimer);
  btnResume.addEventListener('click', resumeTimer);
  document.getElementById('btn-skip').addEventListener('click', skipTimer);

  // Settings toggle
  var settingsPanel = document.getElementById('settings-panel');
  document.getElementById('settings-toggle').addEventListener('click', function() {
    settingsPanel.classList.toggle('open');
  });

  // Settings inputs
  ['set-work', 'set-break', 'set-longbreak', 'set-sbl'].forEach(function(id) {
    document.getElementById(id).addEventListener('change', function() {
      state.workDuration = parseInt(document.getElementById('set-work').value) || 25;
      state.breakDuration = parseInt(document.getElementById('set-break').value) || 5;
      state.longBreakDuration = parseInt(document.getElementById('set-longbreak').value) || 15;
      state.sessionsBeforeLongBreak = parseInt(document.getElementById('set-sbl').value) || 4;
      if (!state.isRunning) {
        state.timeRemaining = getTotalSeconds();
        updateDisplay();
      }
      saveState();
    });
  });

  // Sound toggle
  var soundBtn = document.getElementById('sound-toggle');
  soundBtn.addEventListener('click', function() {
    state.soundEnabled = !state.soundEnabled;
    soundBtn.classList.toggle('on', state.soundEnabled);
    saveState();
  });

  // If timer was running when panel was re-rendered, auto-resume
  if (state.isRunning) {
    interval = setInterval(tick, 1000);
  }

  updateDisplay();
})();
</script>
]],
    s.workDuration, s.breakDuration, s.longBreakDuration, s.sessionsBeforeLongBreak,
    s.soundEnabled and "on" or "",
    (notebook_id:gsub("'", "\\'")),
    s.mode, s.timeRemaining,
    s.isRunning and "true" or "false",
    s.sessionsCompleted, s.todaySessions,
    s.workDuration, s.breakDuration, s.longBreakDuration, s.sessionsBeforeLongBreak,
    s.soundEnabled and "true" or "false"
  )

  return nous.json_encode({ html = html })
end

function handle_panel_action(input_json)
  local input = nous.json_decode(input_json)
  local action = input.action or ""

  if action == "save_state" then
    _pomo_state.mode = input.mode or _pomo_state.mode
    _pomo_state.timeRemaining = input.timeRemaining or _pomo_state.timeRemaining
    _pomo_state.isRunning = input.isRunning or false
    _pomo_state.sessionsCompleted = input.sessionsCompleted or _pomo_state.sessionsCompleted
    _pomo_state.todaySessions = input.todaySessions or _pomo_state.todaySessions
    if input.workDuration then _pomo_state.workDuration = input.workDuration end
    if input.breakDuration then _pomo_state.breakDuration = input.breakDuration end
    if input.longBreakDuration then _pomo_state.longBreakDuration = input.longBreakDuration end
    if input.sessionsBeforeLongBreak then _pomo_state.sessionsBeforeLongBreak = input.sessionsBeforeLongBreak end
    if input.soundEnabled ~= nil then _pomo_state.soundEnabled = input.soundEnabled end
    return nous.json_encode({ saved = true })

  elseif action == "log_session" then
    local notebook_id = input.notebookId or ""
    local mode = input.mode or "work"
    local duration = input.duration or 25

    local db_id = find_or_create_pomo_db(notebook_id)
    if db_id then
      pcall(function()
        local dt = nous.current_datetime()
        local time_str = string.format("%02d:%02d", dt.hour, dt.minute)
        nous.database_add_rows(notebook_id, db_id, nous.json_encode({
          {
            ["Date"] = dt.iso,
            ["Time"] = time_str,
            ["Mode"] = mode,
            ["Duration (min)"] = tostring(duration),
          }
        }))
      end)
    end
    return nous.json_encode({ logged = true })
  end

  return nous.json_encode({ handled = true })
end
