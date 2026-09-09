/**
 * SlottD Vendor Asset: GitHub Markdown Toolbar Custom Element (<markdown-toolbar>)
 * Inspired by @github/markdown-toolbar-element with native browser Undo/Redo (Cmd+Z) preservation.
 * Served directly from Worker isolate at /admin/vendor/markdown-toolbar.js for 100% offline resilience.
 */

export const MARKDOWN_TOOLBAR_VENDOR_JS = `
(function() {
  if (typeof window === 'undefined' || typeof customElements === 'undefined') return;
  if (customElements.get('markdown-toolbar')) return;

  function insertText(textarea, before, after, multiline) {
    if (!textarea) return;
    textarea.focus();
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    var val = textarea.value;
    var selected = val.slice(start, end);

    var replacement = '';
    var newStart = start;
    var newEnd = end;

    if (multiline && selected.indexOf('\\n') !== -1) {
      var lines = selected.split('\\n');
      replacement = lines.map(function(line) { return before + line + (after || ''); }).join('\\n');
      newStart = start;
      newEnd = start + replacement.length;
    } else {
      replacement = before + selected + (after || '');
      if (start === end) {
        newStart = start + before.length;
        newEnd = newStart;
      } else {
        newStart = start;
        newEnd = start + replacement.length;
      }
    }

    var success = false;
    try {
      success = document.execCommand('insertText', false, replacement);
    } catch (e) {
      success = false;
    }

    if (!success) {
      textarea.setRangeText(replacement, start, end, 'select');
    }

    textarea.setSelectionRange(newStart, newEnd);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function insertLink(textarea) {
    if (!textarea) return;
    textarea.focus();
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    var selected = textarea.value.slice(start, end) || 'link text';
    var url = 'https://example.com';

    insertText(textarea, '[' + selected + '](', ')');
    var urlStart = start + selected.length + 3;
    var urlEnd = urlStart + url.length;
    textarea.setSelectionRange(urlStart, urlEnd);
  }

  class MarkdownToolbarElement extends HTMLElement {
    connectedCallback() {
      this.addEventListener('click', this.handleClick.bind(this));
      this.setupShortcuts();
    }

    getTextarea() {
      var forId = this.getAttribute('for');
      if (forId) {
        var el = document.getElementById(forId);
        if (el && el.tagName === 'TEXTAREA') return el;
      }
      var parent = this.closest('.editor-container-wrapper, .form-group, form, div');
      if (parent) {
        var ta = parent.querySelector('textarea');
        if (ta) return ta;
      }
      return null;
    }

    setupShortcuts() {
      var self = this;
      var textarea = this.getTextarea();
      if (!textarea) {
        setTimeout(function() { self.setupShortcuts(); }, 100);
        return;
      }
      if (textarea._mdToolbarBound) return;
      textarea._mdToolbarBound = true;

      textarea.addEventListener('keydown', function(e) {
        var isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        var mod = isMac ? e.metaKey : e.ctrlKey;
        if (!mod) return;

        var key = (e.key || '').toLowerCase();
        if (key === 'b') {
          e.preventDefault();
          insertText(textarea, '**', '**');
        } else if (key === 'i') {
          e.preventDefault();
          insertText(textarea, '*', '*');
        } else if (key === 'k') {
          e.preventDefault();
          insertLink(textarea);
        }
      });
    }

    handleClick(event) {
      var target = event.target.closest('button, [data-md-action]');
      if (!target) return;

      var textarea = this.getTextarea();
      if (!textarea) return;

      event.preventDefault();
      var action = target.getAttribute('data-md-action') || target.tagName.toLowerCase().replace('md-', '');

      switch (action) {
        case 'bold':
          insertText(textarea, '**', '**');
          break;
        case 'italic':
          insertText(textarea, '*', '*');
          break;
        case 'header':
        case 'h2': {
          var level = target.getAttribute('data-level') || '2';
          var prefix = '#'.repeat(Number(level)) + ' ';
          insertText(textarea, prefix, '', true);
          break;
        }
        case 'h3': {
          insertText(textarea, '### ', '', true);
          break;
        }
        case 'quote':
          insertText(textarea, '> ', '', true);
          break;
        case 'code':
          if (textarea.selectionStart !== textarea.selectionEnd && textarea.value.slice(textarea.selectionStart, textarea.selectionEnd).indexOf('\\n') !== -1) {
            insertText(textarea, '\`\`\`\\n', '\\n\`\`\`');
          } else {
            insertText(textarea, '\`', '\`');
          }
          break;
        case 'link':
          insertLink(textarea);
          break;
        case 'unordered-list':
        case 'list':
          insertText(textarea, '- ', '', true);
          break;
        case 'ordered-list':
          insertText(textarea, '1. ', '', true);
          break;
      }
    }
  }

  customElements.define('markdown-toolbar', MarkdownToolbarElement);
})();
`;
