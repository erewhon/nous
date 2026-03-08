--[[ [manifest]
id = "nous.builtin.kanban-board"
name = "Kanban Board"
version = "0.1.0"
description = "A simple Kanban board page type with columns and cards."
capabilities = ["page_type", "page_read", "page_write"]
hooks = ["page_type:kanban"]
is_builtin = true
]]

function describe_page_type(_input_json)
  return nous.json_encode({
    page_type_id = "kanban",
    label = "Kanban Board",
    description = "A drag-and-drop Kanban board with customizable columns",
    icon_svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>',
  })
end

-- Default board data for new pages
local function default_board()
  return {
    columns = {
      { id = "todo", title = "To Do", cards = {} },
      { id = "doing", title = "In Progress", cards = {} },
      { id = "done", title = "Done", cards = {} },
    },
    next_card_id = 1,
  }
end

-- Generate a unique card ID
local function gen_card_id(board)
  local id = board.next_card_id or 1
  board.next_card_id = id + 1
  return "card-" .. tostring(id)
end

-- CSS for the Kanban board
local function board_css()
  return [[
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: transparent;
    color: #e0e0e0;
    padding: 16px;
    height: 100vh;
    overflow: hidden;
  }
  .board {
    display: flex;
    gap: 12px;
    height: calc(100vh - 80px);
    overflow-x: auto;
    padding-bottom: 8px;
  }
  .column {
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px;
    min-width: 240px;
    max-width: 300px;
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .column-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #aaa;
  }
  .column-header .count {
    background: rgba(255,255,255,0.08);
    border-radius: 10px;
    padding: 1px 7px;
    font-size: 10px;
    font-weight: 500;
  }
  .column-cards {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .card {
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 6px;
    padding: 10px 12px;
    cursor: grab;
    transition: background 0.15s, border-color 0.15s, transform 0.1s;
    font-size: 13px;
    line-height: 1.4;
    position: relative;
  }
  .card:hover {
    background: rgba(255,255,255,0.10);
    border-color: rgba(255,255,255,0.15);
  }
  .card.dragging {
    opacity: 0.5;
    transform: scale(0.98);
  }
  .card .card-title {
    font-weight: 500;
    color: #e0e0e0;
  }
  .card .card-desc {
    color: #888;
    font-size: 11px;
    margin-top: 4px;
  }
  .card .card-actions {
    position: absolute;
    top: 6px;
    right: 6px;
    display: none;
    gap: 2px;
  }
  .card:hover .card-actions {
    display: flex;
  }
  .card-actions button {
    background: rgba(255,255,255,0.1);
    border: none;
    color: #aaa;
    width: 20px;
    height: 20px;
    border-radius: 3px;
    cursor: pointer;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }
  .card-actions button:hover {
    background: rgba(255,255,255,0.2);
    color: #fff;
  }
  .column-footer {
    padding: 8px;
    border-top: 1px solid rgba(255,255,255,0.06);
  }
  .add-card-btn {
    background: none;
    border: 1px dashed rgba(255,255,255,0.12);
    color: #888;
    width: 100%;
    padding: 6px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    transition: background 0.15s, color 0.15s;
  }
  .add-card-btn:hover {
    background: rgba(255,255,255,0.04);
    color: #bbb;
    border-color: rgba(255,255,255,0.2);
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }
  .toolbar button {
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.1);
    color: #ccc;
    padding: 5px 12px;
    border-radius: 5px;
    cursor: pointer;
    font-size: 12px;
    transition: background 0.15s;
  }
  .toolbar button:hover {
    background: rgba(255,255,255,0.12);
    color: #fff;
  }
  .column.drag-over {
    background: rgba(100,180,255,0.06);
    border-color: rgba(100,180,255,0.3);
  }
  /* Edit modal */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }
  .modal {
    background: #1e1e2e;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 10px;
    padding: 20px;
    width: 360px;
    max-width: 90vw;
  }
  .modal h3 {
    color: #e0e0e0;
    font-size: 14px;
    margin-bottom: 12px;
  }
  .modal input, .modal textarea {
    width: 100%;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 5px;
    color: #e0e0e0;
    padding: 8px 10px;
    font-size: 13px;
    font-family: inherit;
    outline: none;
    margin-bottom: 10px;
  }
  .modal input:focus, .modal textarea:focus {
    border-color: rgba(100,180,255,0.5);
  }
  .modal textarea {
    resize: vertical;
    min-height: 60px;
  }
  .modal .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .modal .modal-actions button {
    padding: 6px 14px;
    border-radius: 5px;
    font-size: 12px;
    cursor: pointer;
    border: 1px solid rgba(255,255,255,0.1);
    transition: background 0.15s;
  }
  .modal .modal-actions .btn-primary {
    background: rgba(100,180,255,0.2);
    color: #7cc4ff;
    border-color: rgba(100,180,255,0.3);
  }
  .modal .modal-actions .btn-primary:hover {
    background: rgba(100,180,255,0.3);
  }
  .modal .modal-actions .btn-secondary {
    background: rgba(255,255,255,0.06);
    color: #aaa;
  }
  .modal .modal-actions .btn-secondary:hover {
    background: rgba(255,255,255,0.12);
  }
</style>
]]
end

-- Render a single card
local function render_card(card, column_id)
  local desc_html = ""
  if card.description and card.description ~= "" then
    desc_html = '<div class="card-desc">' .. card.description .. '</div>'
  end
  return '<div class="card" draggable="true" data-card-id="' .. card.id .. '" data-column-id="' .. column_id .. '">'
    .. '<div class="card-actions">'
    .. '<button onclick="editCard(\'' .. card.id .. '\', \'' .. column_id .. '\')" title="Edit">&#9998;</button>'
    .. '<button onclick="deleteCard(\'' .. card.id .. '\', \'' .. column_id .. '\')" title="Delete">&times;</button>'
    .. '</div>'
    .. '<div class="card-title">' .. (card.title or "Untitled") .. '</div>'
    .. desc_html
    .. '</div>'
end

-- Render the full board
local function render_board(board)
  local parts = {}
  table.insert(parts, board_css())
  table.insert(parts, '<div class="toolbar">')
  table.insert(parts, '<button onclick="addColumn()">+ Add Column</button>')
  table.insert(parts, '</div>')
  table.insert(parts, '<div class="board" id="board">')

  for _, col in ipairs(board.columns) do
    table.insert(parts, '<div class="column" data-column-id="' .. col.id .. '"')
    table.insert(parts, ' ondragover="handleDragOver(event)" ondrop="handleDrop(event, \'' .. col.id .. '\')"')
    table.insert(parts, ' ondragenter="handleDragEnter(event)" ondragleave="handleDragLeave(event)">')
    table.insert(parts, '<div class="column-header">')
    table.insert(parts, '<span>' .. col.title .. '</span>')
    table.insert(parts, '<span class="count">' .. #col.cards .. '</span>')
    table.insert(parts, '</div>')
    table.insert(parts, '<div class="column-cards">')
    for _, card in ipairs(col.cards) do
      table.insert(parts, render_card(card, col.id))
    end
    table.insert(parts, '</div>')
    table.insert(parts, '<div class="column-footer">')
    table.insert(parts, '<button class="add-card-btn" onclick="addCard(\'' .. col.id .. '\')">+ Add Card</button>')
    table.insert(parts, '</div>')
    table.insert(parts, '</div>')
  end

  table.insert(parts, '</div>')

  -- JavaScript for drag-and-drop and interactions
  table.insert(parts, [[
<script>
  let draggedCardId = null;
  let draggedFromColumn = null;

  // Drag handlers
  document.addEventListener('dragstart', function(e) {
    const card = e.target.closest('.card');
    if (!card) return;
    draggedCardId = card.dataset.cardId;
    draggedFromColumn = card.dataset.columnId;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  document.addEventListener('dragend', function(e) {
    const card = e.target.closest('.card');
    if (card) card.classList.remove('dragging');
    document.querySelectorAll('.column').forEach(c => c.classList.remove('drag-over'));
  });

  function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  function handleDragEnter(e) {
    e.preventDefault();
    const col = e.currentTarget;
    if (col) col.classList.add('drag-over');
  }

  function handleDragLeave(e) {
    const col = e.currentTarget;
    if (col && !col.contains(e.relatedTarget)) {
      col.classList.remove('drag-over');
    }
  }

  function handleDrop(e, targetColumnId) {
    e.preventDefault();
    const col = e.currentTarget;
    if (col) col.classList.remove('drag-over');

    if (draggedCardId && draggedFromColumn && draggedFromColumn !== targetColumnId) {
      sendAction('move_card', {
        card_id: draggedCardId,
        from_column: draggedFromColumn,
        to_column: targetColumnId
      });
    }
    draggedCardId = null;
    draggedFromColumn = null;
  }

  // Card actions
  function addCard(columnId) {
    const title = prompt('Card title:');
    if (title && title.trim()) {
      sendAction('add_card', { column_id: columnId, title: title.trim() });
    }
  }

  function editCard(cardId, columnId) {
    // Show edit modal
    const card = document.querySelector('[data-card-id="' + cardId + '"]');
    const currentTitle = card ? card.querySelector('.card-title').textContent : '';
    const descEl = card ? card.querySelector('.card-desc') : null;
    const currentDesc = descEl ? descEl.textContent : '';

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = '<div class="modal">'
      + '<h3>Edit Card</h3>'
      + '<input type="text" id="edit-title" placeholder="Title" value="' + currentTitle.replace(/"/g, '&quot;') + '">'
      + '<textarea id="edit-desc" placeholder="Description (optional)">' + currentDesc + '</textarea>'
      + '<div class="modal-actions">'
      + '<button class="btn-secondary" onclick="this.closest(\'.modal-overlay\').remove()">Cancel</button>'
      + '<button class="btn-primary" onclick="saveEdit(\'' + cardId + '\', \'' + columnId + '\')">Save</button>'
      + '</div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#edit-title').focus();
    overlay.querySelector('#edit-title').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') saveEdit(cardId, columnId);
    });
  }

  function saveEdit(cardId, columnId) {
    const title = document.getElementById('edit-title').value.trim();
    const desc = document.getElementById('edit-desc').value.trim();
    if (title) {
      sendAction('edit_card', { card_id: cardId, column_id: columnId, title: title, description: desc });
    }
    const overlay = document.querySelector('.modal-overlay');
    if (overlay) overlay.remove();
  }

  function deleteCard(cardId, columnId) {
    sendAction('delete_card', { card_id: cardId, column_id: columnId });
  }

  function addColumn() {
    const title = prompt('Column title:');
    if (title && title.trim()) {
      sendAction('add_column', { title: title.trim() });
    }
  }

  function sendAction(action, data) {
    window.parent.postMessage({
      type: 'plugin-page-action',
      payload: { action: action, data: data }
    }, '*');
  }
</script>
]])

  return table.concat(parts)
end

function render_page(input_json)
  local input = nous.json_decode(input_json)
  local page = input.page or {}
  local board = page.plugin_data

  -- Initialize default board if no data exists
  if not board or type(board) ~= "table" or not board.columns then
    board = default_board()
  end

  -- Store current board state for action handling
  _kanban_boards = _kanban_boards or {}
  _kanban_boards[page.page_id] = board
  _kanban_current_page = page.page_id

  return nous.json_encode({
    html = render_board(board),
  })
end

function handle_page_action(input_json)
  local input = nous.json_decode(input_json)
  local action = input.action or ""
  local data = input.data or {}

  -- Find the board for this page (from render state)
  -- The action payload should include enough context
  _kanban_boards = _kanban_boards or {}

  -- We need to find the board - use a global for the "current" page
  local page_id = input.page_id or _kanban_current_page
  local board = _kanban_boards[page_id]

  if not board then
    board = default_board()
  end

  if action == "add_card" then
    local col_id = data.column_id
    local title = data.title
    if col_id and title then
      for _, col in ipairs(board.columns) do
        if col.id == col_id then
          local card_id = gen_card_id(board)
          table.insert(col.cards, { id = card_id, title = title, description = "" })
          break
        end
      end
    end

  elseif action == "edit_card" then
    local card_id = data.card_id
    local col_id = data.column_id
    local title = data.title
    local desc = data.description or ""
    if card_id and col_id then
      for _, col in ipairs(board.columns) do
        if col.id == col_id then
          for _, card in ipairs(col.cards) do
            if card.id == card_id then
              card.title = title
              card.description = desc
              break
            end
          end
          break
        end
      end
    end

  elseif action == "delete_card" then
    local card_id = data.card_id
    local col_id = data.column_id
    if card_id and col_id then
      for _, col in ipairs(board.columns) do
        if col.id == col_id then
          for i, card in ipairs(col.cards) do
            if card.id == card_id then
              table.remove(col.cards, i)
              break
            end
          end
          break
        end
      end
    end

  elseif action == "move_card" then
    local card_id = data.card_id
    local from_col = data.from_column
    local to_col = data.to_column
    if card_id and from_col and to_col then
      local moved_card = nil
      -- Remove from source column
      for _, col in ipairs(board.columns) do
        if col.id == from_col then
          for i, card in ipairs(col.cards) do
            if card.id == card_id then
              moved_card = table.remove(col.cards, i)
              break
            end
          end
          break
        end
      end
      -- Add to target column
      if moved_card then
        for _, col in ipairs(board.columns) do
          if col.id == to_col then
            table.insert(col.cards, moved_card)
            break
          end
        end
      end
    end

  elseif action == "add_column" then
    local title = data.title
    if title then
      local col_id = "col-" .. tostring(#board.columns + 1) .. "-" .. tostring(math.random(100000, 999999))
      table.insert(board.columns, { id = col_id, title = title, cards = {} })
    end
  end

  -- Store updated board
  if page_id then
    _kanban_boards[page_id] = board
  end

  -- Return updated HTML and data for persistence
  return nous.json_encode({
    html = render_board(board),
    plugin_data = board,
  })
end
