mod app_state;
mod content_widget;
mod key_handler;
mod search_bar;
mod status_bar;
mod tree_widget;
mod ui;

use std::io;
use std::time::Duration;

use anyhow::Result;
use crossterm::event::{self, DisableMouseCapture, EnableMouseCapture, Event, KeyEventKind};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::prelude::*;

use crate::app::App;
use app_state::TuiState;

pub fn run(library_name: Option<&str>) -> Result<()> {
    let app = App::new(library_name)?;
    let mut state = TuiState::new(app)?;

    // Setup terminal
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    // Event loop
    let result = run_loop(&mut terminal, &mut state);

    // Restore terminal
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen, DisableMouseCapture)?;
    terminal.show_cursor()?;

    result
}

fn run_loop<B: Backend>(terminal: &mut Terminal<B>, state: &mut TuiState) -> Result<()> {
    loop {
        terminal.draw(|f| ui::draw(f, state))?;

        if state.quit {
            return Ok(());
        }

        // Poll for events with timeout
        if event::poll(Duration::from_millis(100))? {
            match event::read()? {
                Event::Key(key) if key.kind == KeyEventKind::Press => {
                    key_handler::handle_key(state, key);
                }
                Event::Mouse(mouse) => {
                    key_handler::handle_mouse(state, mouse);
                }
                _ => {}
            }
        }
    }
}
