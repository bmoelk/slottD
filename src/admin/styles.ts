export const adminStyles = `
  :root {
    --bg: #090d16;
    --surface: #0f172a;
    --surface-hover: #1e293b;
    --surface-border: #1e293b;
    --text: #f8fafc;
    --text-muted: #94a3b8;
    --text-dim: #64748b;
    --primary: #FF8A00;
    --primary-hover: #FFAA00;
    --accent: #FFD043;
    --danger: #ef4444;
    --danger-hover: #dc2626;
    --success: #10b981;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  body { background: var(--bg); color: var(--text); padding: 24px; min-height: 100vh; }
  .topbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; border-bottom: 1px solid var(--surface-border); padding-bottom: 16px; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand h1 { font-size: 18px; font-weight: 700; color: #fff; }
  .nav-tabs { display: flex; gap: 8px; }
  .nav-tab { padding: 6px 14px; border-radius: 6px; text-decoration: none; color: var(--text-muted); font-size: 13px; font-weight: 600; transition: 0.2s; }
  .nav-tab:hover { color: #fff; background: var(--surface-border); }
  .nav-tab.active { color: #000; background: var(--accent); }
  .user-badge { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-muted); background: #1e293b; padding: 4px 10px; border-radius: 99px; }
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  .header-stats { display: flex; gap: 8px; }
  .stat-pill { background: #1e293b; color: var(--accent); font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 99px; border: 1px solid #334155; }
  .card { background: var(--surface); border: 1px solid var(--surface-border); border-radius: 12px; padding: 20px; margin-bottom: 20px; }
  .danger-card { border-color: rgba(239, 68, 68, 0.3); background: rgba(239, 68, 68, 0.04); }
  .subtitle { color: var(--text-muted); font-size: 14px; margin-top: 4px; }

  /* Toolbar / Search / Filter Controls */
  .toolbar { display: flex; flex-direction: column; gap: 14px; padding: 14px 18px; margin-bottom: 20px; }
  .toolbar-search { position: relative; width: 100%; }
  .search-icon { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); font-size: 14px; pointer-events: none; opacity: 0.6; }
  .input-search { width: 100%; background: #090d16; border: 1px solid var(--surface-border); color: #fff; padding: 10px 14px 10px 38px; border-radius: 8px; font-size: 14px; outline: none; transition: 0.2s; }
  .input-search:focus { border-color: var(--primary); box-shadow: 0 0 0 2px rgba(255, 138, 0, 0.2); }
  .toolbar-actions { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
  .toolbar-right-controls { display: flex; align-items: center; gap: 12px; margin-left: auto; }
  .filter-pills { display: flex; gap: 6px; flex-wrap: wrap; }
  .pill-btn { background: #090d16; border: 1px solid var(--surface-border); color: var(--text-muted); padding: 5px 12px; border-radius: 99px; font-size: 12px; font-weight: 600; cursor: pointer; transition: 0.2s; display: inline-flex; align-items: center; gap: 6px; }
  .pill-btn:hover { color: #fff; border-color: #334155; }
  .pill-btn.active { background: #1e293b; color: #fff; border-color: var(--primary); }
  .pill-count { background: #090d16; padding: 1px 6px; border-radius: 99px; font-size: 10px; color: var(--accent); }
  .sort-control { display: flex; align-items: center; gap: 8px; }
  .sort-label { font-size: 12px; font-weight: 600; color: var(--text-muted); }
  .sort-select { padding: 5px 10px; font-size: 12px; width: auto; background: #090d16; }

  /* View Layout Toggle */
  .view-toggle, .view-toggle-group {
    display: flex;
    background: #090d16;
    border: 1px solid var(--surface-border);
    border-radius: 8px;
    padding: 2px;
    gap: 2px;
  }
  .view-btn, .toggle-btn {
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-muted);
    padding: 5px 9px;
    font-size: 12px;
    font-weight: 600;
    border-radius: 6px;
    cursor: pointer;
    transition: 0.15s;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .view-btn:hover, .toggle-btn:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.05);
  }
  .view-btn.active, .toggle-btn.active {
    background: #1e293b;
    color: var(--primary);
    border-color: #334155;
  }

  /* Collection Grid View (Default Cards) */
  .collection-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
  .collection-card-wrapper { background: var(--surface); border: 1px solid var(--surface-border); border-radius: 12px; display: flex; flex-direction: column; overflow: hidden; transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1); }
  .collection-card-wrapper:hover { border-color: var(--primary); transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.3); }
  .collection-card-wrapper.keyboard-highlight { border-color: var(--primary) !important; box-shadow: 0 0 0 2px var(--primary), 0 8px 24px rgba(0,0,0,0.5) !important; background: #1e293b !important; transform: translateY(-2px); }
  .collection-card { padding: 18px 18px 14px; text-decoration: none; color: inherit; flex: 1; display: flex; flex-direction: column; gap: 12px; }
  .col-card-header { display: flex; justify-content: space-between; align-items: center; }
  .col-icon-box { font-size: 26px; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; background: #090d16; border-radius: 8px; border: 1px solid var(--surface-border); flex-shrink: 0; }
  .col-badges { display: flex; align-items: center; gap: 6px; }
  .pack-badge { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 4px; text-transform: uppercase; background: #1e293b; color: #94a3b8; border: 1px solid #334155; }
  .pack-slotwire-pack, .pack-slotwire { background: rgba(255, 138, 0, 0.15); color: var(--primary); border-color: rgba(255, 138, 0, 0.3); }
  .pack-site-custom, .pack-custom { background: rgba(56, 189, 248, 0.15); color: #38bdf8; border-color: rgba(56, 189, 248, 0.3); }
  .pack-blog-pack, .pack-blog { background: rgba(16, 185, 129, 0.15); color: #34d399; border-color: rgba(16, 185, 129, 0.3); }
  .count-pill { font-size: 11px; font-weight: 700; color: #fff; background: #090d16; padding: 2px 8px; border-radius: 99px; border: 1px solid var(--surface-border); white-space: nowrap; }
  .col-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .col-title-group { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .col-title { font-size: 16px; font-weight: 700; color: #fff; }
  .col-key { font-size: 12px; color: var(--text-dim); font-family: monospace; }
  .col-desc { font-size: 12px; color: var(--text-muted); line-height: 1.4; margin-top: 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .col-card-footer { display: flex; border-top: 1px solid var(--surface-border); background: rgba(0,0,0,0.15); }
  .btn-card-action { flex: 1; text-align: center; padding: 9px 12px; font-size: 12px; font-weight: 600; color: var(--text-muted); text-decoration: none; transition: 0.15s; }
  .btn-card-action:hover { color: #fff; background: #1e293b; }
  .btn-card-primary { border-left: 1px solid var(--surface-border); color: var(--primary); flex: 0 0 70px; }
  .btn-card-primary:hover { background: var(--primary); color: #000; }

  /* ── Row / List View Layout (One Line per Collection) ─────────────────── */
  .collection-grid.view-rows {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .collection-grid.view-rows .collection-card-wrapper {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    border-radius: 10px;
    background: var(--surface);
    border: 1px solid var(--surface-border);
  }
  .collection-grid.view-rows .collection-card-wrapper:hover {
    transform: translateX(4px);
    border-color: var(--primary);
    background: #141f36;
  }
  .collection-grid.view-rows .collection-card-wrapper.keyboard-highlight {
    border-color: var(--primary) !important;
    box-shadow: 0 0 0 2px var(--primary), 0 8px 24px rgba(0,0,0,0.5) !important;
    background: #1e293b !important;
    transform: translateX(6px) !important;
  }
  .collection-grid.view-rows .collection-card {
    flex-direction: row;
    align-items: center;
    padding: 0;
    gap: 16px;
    flex: 1;
    min-width: 0;
  }
  .collection-grid.view-rows .col-card-header {
    flex: none;
  }
  .collection-grid.view-rows .col-icon-box {
    width: 38px;
    height: 38px;
    font-size: 20px;
  }
  .collection-grid.view-rows .col-info {
    flex-direction: row;
    align-items: center;
    gap: 16px;
    flex: 1;
    min-width: 0;
  }
  .collection-grid.view-rows .col-title-group {
    flex: 0 0 220px;
    min-width: 0;
  }
  .collection-grid.view-rows .col-title {
    font-size: 15px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .collection-grid.view-rows .col-desc {
    display: inline-block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
    max-width: 500px;
    margin-top: 0;
    color: var(--text-dim);
    font-size: 13px;
  }
  .collection-grid.view-rows .col-badges {
    margin-left: auto;
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .collection-grid.view-rows .col-card-footer {
    border-top: none;
    background: transparent;
    border-left: 1px solid var(--surface-border);
    padding-left: 14px;
    margin-left: 14px;
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
  }
  .collection-grid.view-rows .btn-card-action {
    padding: 6px 14px;
    border-radius: 6px;
    background: #090d16;
    border: 1px solid var(--surface-border);
    flex: none;
    font-size: 12px;
  }
  .collection-grid.view-rows .btn-card-action:hover {
    background: #1e293b;
    color: #fff;
    border-color: #334155;
  }
  .collection-grid.view-rows .btn-card-primary {
    border: 1px solid var(--primary);
    background: var(--primary);
    color: #000;
    font-weight: 700;
  }
  .collection-grid.view-rows .btn-card-primary:hover {
    background: var(--primary-hover);
    border-color: var(--primary-hover);
  }

  /* Tables & Row Selection */
  .table-card { padding: 0; overflow: hidden; }
  .table { width: 100%; border-collapse: collapse; text-align: left; }
  .table th, .table td { padding: 12px 16px; border-bottom: 1px solid var(--surface-border); font-size: 14px; }
  .table th { color: var(--text-muted); font-weight: 600; background: #0d1322; }
  .sortable-th { cursor: pointer; user-select: none; transition: 0.15s; }
  .sortable-th:hover { color: #fff; }
  .sort-indicator { font-size: 11px; opacity: 0.5; margin-left: 4px; }
  .table a { color: var(--text); text-decoration: none; }
  .table a:hover { color: var(--primary); }
  .action-divider { color: var(--surface-border); margin: 0 6px; }
  .row-selected { background: rgba(255, 138, 0, 0.08) !important; }
  .item-row.keyboard-highlight { background: rgba(255, 138, 0, 0.16) !important; outline: 1px solid var(--primary); }
  .empty-cell { text-align: center; padding: 48px 16px; color: var(--text-muted); }
  .empty-state { text-align: center; padding: 48px 24px; color: var(--text-muted); }
  .empty-icon { font-size: 36px; margin-bottom: 12px; }
  .empty-subtitle { font-size: 13px; color: var(--text-dim); margin-top: 4px; margin-bottom: 16px; }

  /* Floating Bulk Actions Toolbar */
  .bulk-toolbar { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: #0f172a; border: 1px solid var(--primary); box-shadow: 0 12px 36px rgba(0,0,0,0.6); padding: 8px 16px; border-radius: 99px; display: flex; align-items: center; gap: 8px; z-index: 1000; }
  .bulk-count { font-size: 13px; color: #fff; padding-right: 4px; }
  .bulk-divider { width: 1px; height: 20px; background: #334155; margin: 0 4px; }
  .btn-bulk { background: #1e293b; border: 1px solid #334155; color: #fff; padding: 6px 12px; border-radius: 99px; font-size: 12px; font-weight: 600; cursor: pointer; transition: 0.2s; display: inline-flex; align-items: center; gap: 6px; }
  .btn-bulk:hover { background: #334155; border-color: #475569; }
  .btn-bulk-publish:hover { background: #064e3b; color: #34d399; border-color: #059669; }
  .btn-bulk-draft:hover { background: #451a03; color: #fb923c; border-color: #d97706; }
  .btn-bulk-archive:hover { background: #334155; color: #94a3b8; }
  .btn-bulk-delete { color: var(--danger); border-color: rgba(239, 68, 68, 0.4); }
  .btn-bulk-delete:hover { background: var(--danger); color: #fff; border-color: var(--danger); }
  .btn-bulk-close { background: none; border: none; color: var(--text-muted); font-size: 14px; cursor: pointer; padding: 4px 8px; border-radius: 99px; }
  .btn-bulk-close:hover { color: #fff; background: #334155; }

  .status-pill { padding: 4px 8px; border-radius: 6px; font-size: 11px; text-transform: uppercase; font-weight: 700; }
  .status-published { background: #064e3b; color: #34d399; }
  .status-draft { background: #451a03; color: #fb923c; }
  .status-archived { background: #334155; color: #94a3b8; }
  .btn { display: inline-flex; align-items: center; justify-content: center; padding: 8px 16px; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; text-decoration: none; border: none; transition: 0.2s; }
  .btn-primary { background: var(--primary); color: #000; }
  .btn-primary:hover { background: var(--primary-hover); }
  .btn-secondary { background: #1e293b; color: #fff; border: 1px solid #334155; }
  .btn-secondary:hover { background: #334155; }
  .btn-danger-outline { background: transparent; border: 1px solid var(--danger); color: var(--danger); }
  .btn-danger-outline:hover { background: var(--danger); color: #fff; }
  .btn-link { color: var(--primary); font-weight: 600; font-size: 13px; text-decoration: none; }
  .btn-link:hover { text-decoration: underline; }
  .btn-text { background: none; border: none; color: var(--primary); cursor: pointer; font-size: 13px; font-weight: 600; padding: 0; }
  .text-danger { color: var(--danger); }
  .text-danger:hover { color: var(--danger-hover); text-decoration: underline; }

  .editor-grid { display: grid; grid-template-columns: 1fr 340px; gap: 24px; }
  .form-group { margin-bottom: 22px; }
  .form-group label { display: block; font-size: 13px; font-weight: 600; color: var(--text-muted); margin-bottom: 6px; }
  .editor-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .mode-switcher { display: flex; gap: 4px; background: #090d16; padding: 2px; border-radius: 6px; border: 1px solid var(--surface-border); }
  .mode-btn { background: transparent; border: none; color: var(--text-muted); padding: 4px 8px; font-size: 11px; font-weight: 600; border-radius: 4px; cursor: pointer; transition: 0.15s; }
  .mode-btn:hover { color: #fff; }
  .mode-btn.active { background: #1e293b; color: #fff; }
  .input-text, .input-select, .input-textarea { width: 100%; background: #090d16; border: 1px solid var(--surface-border); color: #fff; padding: 10px 12px; border-radius: 6px; font-size: 14px; outline: none; }
  .input-text:focus, .input-select:focus, .input-textarea:focus { border-color: var(--primary); }
  .breadcrumbs { display: flex; gap: 8px; font-size: 14px; color: var(--text-muted); align-items: center; }
  .breadcrumbs a { color: var(--text-muted); text-decoration: none; }
  .breadcrumbs a:hover { color: #fff; }
  .breadcrumbs .current { color: #fff; font-weight: 600; }
  .meta-info p { font-size: 13px; color: var(--text-muted); margin-bottom: 8px; }
  .divider { border: 0; height: 1px; background: var(--surface-border); margin: 16px 0; }
  
  /* Toast-UI & Trix Styles */
  .toastui-editor-defaultUI { background: #090d16 !important; border-color: var(--surface-border) !important; border-radius: 6px; color: #f8fafc !important; }
  .toastui-editor-defaultUI .ProseMirror { color: #f8fafc !important; }
  .toastui-editor-toolbar { background: #0f172a !important; border-bottom: 1px solid var(--surface-border) !important; }
  .toastui-editor-md-container, .toastui-editor-ww-container { background: #090d16 !important; }
  .trix-wrapper { background: #090d16; border: 1px solid var(--surface-border); border-radius: 6px; padding: 12px; min-height: 250px; }
  trix-toolbar .trix-button-group { background: #1e293b; border-color: #334155; }
  trix-toolbar .trix-button { border-color: #334155; }
  trix-editor { min-height: 220px; outline: none; color: #f8fafc; }
  .media-preview-card { display: flex; align-items: center; gap: 14px; background: #090d16; border: 1px solid var(--surface-border); padding: 10px; border-radius: 8px; margin-bottom: 10px; }
  .media-preview-card img { width: 64px; height: 64px; object-fit: cover; border-radius: 6px; background: #1e293b; }
  .media-preview-details { flex: 1; min-width: 0; }
  .media-preview-path { font-size: 12px; color: var(--text-muted); word-break: break-all; font-family: monospace; display: block; margin-bottom: 4px; }
  .media-preview-actions { display: flex; gap: 10px; font-size: 12px; }
  .media-input-row { display: flex; gap: 8px; }
  .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.75); display: flex; align-items: center; justify-content: center; z-index: 999; }
  .modal-dialog { background: var(--surface); border: 1px solid var(--surface-border); border-radius: 12px; width: 680px; max-width: 90vw; max-height: 80vh; display: flex; flex-direction: column; }
  .modal-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid var(--surface-border); }
  .btn-close { background: none; border: none; color: var(--text-muted); font-size: 18px; cursor: pointer; }
  .modal-body { padding: 20px; overflow-y: auto; }
  .modal-actions { display: flex; gap: 10px; margin-bottom: 16px; }
  .modal-media-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 12px; }
  .modal-media-item { border: 1px solid var(--surface-border); border-radius: 6px; padding: 6px; cursor: pointer; text-align: center; transition: 0.2s; background: #090d16; }
  .modal-media-item:hover { border-color: var(--primary); transform: scale(1.02); }
  .modal-media-item img { width: 100%; height: 80px; object-fit: cover; border-radius: 4px; }
  .modal-media-name { display: block; font-size: 11px; color: var(--text-muted); margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .media-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
  .media-card { background: var(--surface); border: 1px solid var(--surface-border); border-radius: 10px; overflow: hidden; }
  .media-thumb-container { height: 140px; background: #090d16; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .media-thumb-container img { width: 100%; height: 100%; object-fit: cover; }
  .media-card-info { padding: 12px; }
  .media-card-info strong { display: block; font-size: 13px; margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .media-key { font-size: 11px; color: var(--text-muted); margin-bottom: 8px; }
  .media-card-footer { display: flex; justify-content: space-between; align-items: center; }
  .file-size { font-size: 11px; color: var(--text-muted); }
  .btn-copy { background: #1e293b; border: 1px solid #334155; color: #fff; padding: 3px 8px; font-size: 11px; border-radius: 4px; cursor: pointer; }
  .badge { background: #1e293b; border: 1px solid #334155; padding: 2px 8px; border-radius: 99px; font-size: 11px; color: var(--accent); }
  .type-pill { background: #1e293b; padding: 2px 6px; border-radius: 4px; font-size: 11px; color: #38bdf8; font-family: monospace; }
  .model-card { margin-bottom: 20px; }
  .model-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
  .model-desc { font-size: 13px; color: var(--text-muted); margin-top: 4px; }
  .model-badges { display: flex; gap: 6px; }
`;
