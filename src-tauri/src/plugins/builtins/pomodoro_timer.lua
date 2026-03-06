--[[ [manifest]
id = "nous.builtin.pomodoro-timer"
name = "Pomodoro Timer"
version = "0.1.0"
description = "A Pomodoro timer block with circular progress, configurable durations, and session tracking."
capabilities = ["block_render"]
hooks = ["block_render:pomodoro"]
is_builtin = true
]]

-- Describe the block type for the slash menu
function describe_block(_input_json)
  return nous.json_encode({
    block_type = "pomodoro",
    label = "Pomodoro Timer",
    icon_svg = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
  })
end

-- Render the pomodoro timer block
function render_block(input_json)
  local input = nous.json_decode(input_json)
  local data = input.data or {}

  -- Defaults
  local mode = data.mode or "work"
  local work_duration = data.workDuration or 25
  local break_duration = data.breakDuration or 5
  local long_break_duration = data.longBreakDuration or 15
  local sessions_before_long = data.sessionsBeforeLongBreak or 4
  local sessions_completed = data.sessionsCompleted or 0
  local is_running = false  -- always start paused on render
  local time_remaining = data.timeRemaining

  -- If no time remaining set, use the mode's duration
  if not time_remaining then
    if mode == "work" then
      time_remaining = work_duration * 60
    elseif mode == "longBreak" then
      time_remaining = long_break_duration * 60
    else
      time_remaining = break_duration * 60
    end
  end

  local html = string.format([[
<div id="pomo-root" style="padding:20px;display:flex;flex-direction:column;align-items:center;gap:16px;font-family:sans-serif;">
  <!-- Circular progress -->
  <div style="position:relative;width:180px;height:180px;">
    <svg id="pomo-svg" width="180" height="180" viewBox="0 0 180 180" style="transform:rotate(-90deg);">
      <circle cx="90" cy="90" r="80" fill="none" stroke="#1a1a2e" stroke-width="10"/>
      <circle id="pomo-arc" cx="90" cy="90" r="80" fill="none" stroke-width="10" stroke-linecap="round"
        stroke-dasharray="502.65" stroke-dashoffset="0"
        style="transition:stroke-dashoffset 0.5s linear;"/>
    </svg>
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
      <div id="pomo-time" style="font-size:36px;font-weight:700;color:#e0e0e0;font-variant-numeric:tabular-nums;">--:--</div>
      <div id="pomo-mode" style="font-size:13px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-top:2px;">work</div>
    </div>
  </div>

  <!-- Controls -->
  <div style="display:flex;gap:8px;">
    <button id="pomo-start" style="padding:6px 16px;font-size:13px;background:#22c55e;color:#fff;border:none;border-radius:6px;cursor:pointer;">Start</button>
    <button id="pomo-pause" style="padding:6px 16px;font-size:13px;background:#eab308;color:#000;border:none;border-radius:6px;cursor:pointer;display:none;">Pause</button>
    <button id="pomo-reset" style="padding:6px 16px;font-size:13px;background:#333;color:#ccc;border:1px solid #444;border-radius:6px;cursor:pointer;">Reset</button>
  </div>

  <!-- Session counter -->
  <div id="pomo-sessions" style="font-size:12px;color:#888;">Sessions: 0</div>

  <!-- Settings -->
  <details style="width:100%%;max-width:300px;">
    <summary style="cursor:pointer;font-size:12px;color:#888;user-select:none;text-align:center;">Settings</summary>
    <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px;">
      <label style="font-size:12px;color:#aaa;display:flex;justify-content:space-between;align-items:center;">
        Work (min):
        <input id="pomo-work" type="number" min="1" max="120" value="%d"
          style="width:60px;background:#1a1a2e;color:#e0e0e0;border:1px solid #333;border-radius:4px;padding:3px 6px;font-size:12px;text-align:center;" />
      </label>
      <label style="font-size:12px;color:#aaa;display:flex;justify-content:space-between;align-items:center;">
        Break (min):
        <input id="pomo-break" type="number" min="1" max="60" value="%d"
          style="width:60px;background:#1a1a2e;color:#e0e0e0;border:1px solid #333;border-radius:4px;padding:3px 6px;font-size:12px;text-align:center;" />
      </label>
      <label style="font-size:12px;color:#aaa;display:flex;justify-content:space-between;align-items:center;">
        Long break (min):
        <input id="pomo-longbreak" type="number" min="1" max="60" value="%d"
          style="width:60px;background:#1a1a2e;color:#e0e0e0;border:1px solid #333;border-radius:4px;padding:3px 6px;font-size:12px;text-align:center;" />
      </label>
      <label style="font-size:12px;color:#aaa;display:flex;justify-content:space-between;align-items:center;">
        Sessions before long break:
        <input id="pomo-sbl" type="number" min="1" max="10" value="%d"
          style="width:60px;background:#1a1a2e;color:#e0e0e0;border:1px solid #333;border-radius:4px;padding:3px 6px;font-size:12px;text-align:center;" />
      </label>
      <button id="pomo-save-settings" style="padding:4px 12px;font-size:12px;background:#3b82f6;color:white;border:none;border-radius:4px;cursor:pointer;align-self:center;margin-top:4px;">Save Settings</button>
    </div>
  </details>
</div>

<script>
(function() {
  var state = {
    mode: '%s',
    timeRemaining: %d,
    isRunning: false,
    sessionsCompleted: %d,
    workDuration: %d,
    breakDuration: %d,
    longBreakDuration: %d,
    sessionsBeforeLongBreak: %d
  };

  var interval = null;
  var arc = document.getElementById('pomo-arc');
  var timeEl = document.getElementById('pomo-time');
  var modeEl = document.getElementById('pomo-mode');
  var sessionsEl = document.getElementById('pomo-sessions');
  var startBtn = document.getElementById('pomo-start');
  var pauseBtn = document.getElementById('pomo-pause');
  var circumference = 2 * Math.PI * 80;

  var modeColors = { work: '#ef4444', break: '#22c55e', longBreak: '#3b82f6' };

  function getTotalSeconds() {
    if (state.mode === 'work') return state.workDuration * 60;
    if (state.mode === 'longBreak') return state.longBreakDuration * 60;
    return state.breakDuration * 60;
  }

  function updateDisplay() {
    var mins = Math.floor(state.timeRemaining / 60);
    var secs = state.timeRemaining %% 60;
    timeEl.textContent = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
    modeEl.textContent = state.mode === 'longBreak' ? 'long break' : state.mode;
    sessionsEl.textContent = 'Sessions: ' + state.sessionsCompleted;

    var total = getTotalSeconds();
    var progress = total > 0 ? state.timeRemaining / total : 0;
    var offset = circumference * (1 - progress);
    arc.setAttribute('stroke-dashoffset', offset);
    arc.setAttribute('stroke', modeColors[state.mode] || '#ef4444');

    startBtn.style.display = state.isRunning ? 'none' : 'inline-block';
    pauseBtn.style.display = state.isRunning ? 'inline-block' : 'none';
  }

  function persistState() {
    window.parent.postMessage({
      type: 'plugin-block-update-data',
      dataJson: JSON.stringify(state)
    }, '*');
  }

  function tick() {
    if (state.timeRemaining > 0) {
      state.timeRemaining--;
      updateDisplay();
    } else {
      // Timer complete — transition
      clearInterval(interval);
      interval = null;
      state.isRunning = false;

      if (state.mode === 'work') {
        state.sessionsCompleted++;
        if (state.sessionsCompleted %% state.sessionsBeforeLongBreak === 0) {
          state.mode = 'longBreak';
          state.timeRemaining = state.longBreakDuration * 60;
        } else {
          state.mode = 'break';
          state.timeRemaining = state.breakDuration * 60;
        }
      } else {
        state.mode = 'work';
        state.timeRemaining = state.workDuration * 60;
      }

      updateDisplay();
      persistState();
    }
  }

  startBtn.addEventListener('click', function() {
    state.isRunning = true;
    interval = setInterval(tick, 1000);
    updateDisplay();
    persistState();
  });

  pauseBtn.addEventListener('click', function() {
    state.isRunning = false;
    clearInterval(interval);
    interval = null;
    updateDisplay();
    persistState();
  });

  document.getElementById('pomo-reset').addEventListener('click', function() {
    state.isRunning = false;
    clearInterval(interval);
    interval = null;
    state.timeRemaining = getTotalSeconds();
    updateDisplay();
    persistState();
  });

  document.getElementById('pomo-save-settings').addEventListener('click', function() {
    state.workDuration = parseInt(document.getElementById('pomo-work').value) || 25;
    state.breakDuration = parseInt(document.getElementById('pomo-break').value) || 5;
    state.longBreakDuration = parseInt(document.getElementById('pomo-longbreak').value) || 15;
    state.sessionsBeforeLongBreak = parseInt(document.getElementById('pomo-sbl').value) || 4;
    // Reset timer to new duration if not running
    if (!state.isRunning) {
      state.timeRemaining = getTotalSeconds();
    }
    updateDisplay();
    persistState();
  });

  // Initial render
  updateDisplay();
})();
</script>
]], work_duration, break_duration, long_break_duration, sessions_before_long,
    mode, time_remaining, sessions_completed, work_duration, break_duration, long_break_duration, sessions_before_long)

  return nous.json_encode({
    html = html,
    styles = "",
    height = 380
  })
end

-- Handle block actions
function handle_block_action(input_json)
  local input = nous.json_decode(input_json)
  return nous.json_encode({ handled = true, action = input.type or "unknown" })
end
