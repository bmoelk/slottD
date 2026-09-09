/**
 * SlottD Vendor Asset: Pell WYSIWYG Micro-Library (<1.5KB, zero-dependency)
 * Served directly from Worker isolate at /admin/vendor/pell.js for 100% offline resilience.
 */

export const PELL_VENDOR_JS = `
(function(global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
  typeof define === 'function' && define.amd ? define(['exports'], factory) :
  (factory((global.pell = {})));
}(typeof window !== 'undefined' ? window : this, (function(exports) {
  var defaultParagraphSeparatorString = 'defaultParagraphSeparator';
  var formatBlock = 'formatBlock';
  var addEventListener = function(parent, type, listener) {
    return parent.addEventListener(type, listener);
  };
  var appendChild = function(parent, child) {
    return parent.appendChild(child);
  };
  var createElement = function(tag) {
    return document.createElement(tag);
  };
  var queryCommandState = function(command) {
    try { return document.queryCommandState(command); } catch (e) { return false; }
  };
  var queryCommandValue = function(command) {
    try { return document.queryCommandValue(command); } catch (e) { return ''; }
  };

  var exec = function(command, value) {
    if (value === void 0) value = null;
    return document.execCommand(command, false, value);
  };

  var defaultActions = {
    bold: {
      icon: '<b>B</b>',
      title: 'Bold (Cmd+B)',
      state: function() { return queryCommandState('bold'); },
      result: function() { return exec('bold'); }
    },
    italic: {
      icon: '<i>I</i>',
      title: 'Italic (Cmd+I)',
      state: function() { return queryCommandState('italic'); },
      result: function() { return exec('italic'); }
    },
    underline: {
      icon: '<u>U</u>',
      title: 'Underline (Cmd+U)',
      state: function() { return queryCommandState('underline'); },
      result: function() { return exec('underline'); }
    },
    heading1: {
      icon: '<b>H1</b>',
      title: 'Heading 1',
      result: function() { return exec(formatBlock, '<h1>'); }
    },
    heading2: {
      icon: '<b>H2</b>',
      title: 'Heading 2',
      result: function() { return exec(formatBlock, '<h2>'); }
    },
    paragraph: {
      icon: '&#182;',
      title: 'Paragraph',
      result: function() { return exec(formatBlock, '<p>'); }
    },
    quote: {
      icon: '&#8220;',
      title: 'Quote',
      result: function() { return exec(formatBlock, '<blockquote>'); }
    },
    olist: {
      icon: '1&#8801;',
      title: 'Numbered List',
      result: function() { return exec('insertOrderedList'); }
    },
    ulist: {
      icon: '&bull;&#8801;',
      title: 'Bullet List',
      result: function() { return exec('insertUnorderedList'); }
    },
    code: {
      icon: '&lt;&gt;',
      title: 'Code Block',
      result: function() { return exec(formatBlock, '<pre>'); }
    },
    line: {
      icon: '&#8213;',
      title: 'Horizontal Rule',
      result: function() { return exec('insertHorizontalRule'); }
    },
    link: {
      icon: '<svg height="14" viewBox="0 0 16 16" width="14" fill="currentColor" style="display:inline-block;vertical-align:middle;"><path d="m7.775 3.275 1.25-1.25a3.5 3.5 0 1 1 4.95 4.95l-2.5 2.5a3.5 3.5 0 0 1-4.95 0 .751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018 1.998 1.998 0 0 0 2.83 0l2.5-2.5a2.002 2.002 0 0 0-2.83-2.83l-1.25 1.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042Zm-1.2 8.72a1.995 1.995 0 0 0 1.425.582 2.003 2.003 0 0 0 1.425-.582.75.75 0 0 1 1.06 1.06 3.5 3.5 0 0 1-4.95 0l-2.5-2.5a3.5 3.5 0 0 1 4.95-4.95l1.25 1.25a.75.75 0 0 1-1.06 1.06l-1.25-1.25a2 2 0 0 0-2.83 2.83l2.5 2.5Z"></path></svg>',
      title: 'Link',
      result: function() {
        var url = window.prompt('Enter link URL (https://...):');
        if (url) exec('createLink', url);
      }
    },
    image: {
      icon: '<svg height="14" viewBox="0 0 16 16" width="14" fill="currentColor" style="display:inline-block;vertical-align:middle;"><path d="M1.75 2.5a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25H1.75ZM1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 13.25 15H2.75A1.75 1.75 0 0 1 1 13.25V2.75Zm10.5 4.75a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm-7.25 5a.75.75 0 0 1-.53-1.28l2.5-2.5a.75.75 0 0 1 1.06 0l1.22 1.22 2.72-2.72a.75.75 0 0 1 1.06 0l2.5 2.5a.75.75 0 0 1-1.06 1.06L11.5 8.81l-2.72 2.72a.75.75 0 0 1-1.06 0L6.5 10.31l-1.72 1.72a.75.75 0 0 1-.53.22Z"></path></svg>',
      title: 'Insert Media from R2 (or Upload)',
      result: function(settings) {
        var fieldName = (settings && settings.fieldName) || (settings && settings.element && settings.element.getAttribute('data-field-name'));
        if (typeof window.openEditorMediaModal === 'function' && fieldName) {
          window.openEditorMediaModal(fieldName, 'html');
        } else {
          var url = window.prompt('Enter image URL:');
          if (url) exec('insertImage', url);
        }
      }
    }
  };

  var defaultClasses = {
    actionbar: 'pell-actionbar',
    button: 'pell-button',
    content: 'pell-content',
    selected: 'pell-button-selected'
  };

  var init = function(settings) {
    var actions = settings.actions ? (
      settings.actions.map(function(action) {
        if (typeof action === 'string') return defaultActions[action];
        else if (defaultActions[action.name]) return Object.assign({}, defaultActions[action.name], action);
        return action;
      })
    ) : Object.keys(defaultActions).map(function(action) { return defaultActions[action]; });

    var classes = Object.assign({}, defaultClasses, settings.classes);
    var defaultParagraphSeparator = settings[defaultParagraphSeparatorString] || 'p';

    settings.element.innerHTML = '';

    var actionbar = createElement('div');
    actionbar.className = classes.actionbar;
    appendChild(settings.element, actionbar);

    var content = settings.element.content = createElement('div');
    content.contentEditable = true;
    content.className = classes.content;
    content.oninput = function(ref) {
      var firstChild = ref.target.firstChild;
      if (firstChild && firstChild.nodeType === 3) exec(formatBlock, '<' + defaultParagraphSeparator + '>');
      else if (content.innerHTML === '<br>') content.innerHTML = '';
      if (typeof settings.onChange === 'function') settings.onChange(content.innerHTML);
    };
    content.onkeydown = function(event) {
      if (event.key === 'Enter' && queryCommandValue(formatBlock) === 'blockquote') {
        setTimeout(function() { return exec(formatBlock, '<' + defaultParagraphSeparator + '>'); }, 0);
      }
    };
    appendChild(settings.element, content);

    actions.forEach(function(action) {
      var button = createElement('button');
      button.type = 'button';
      button.className = classes.button;
      button.innerHTML = action.icon;
      button.title = action.title;
      button.onclick = function() {
        action.result(settings) && content.focus();
      };
      if (action.state) {
        var handler = function() {
          button.classList[action.state() ? 'add' : 'remove'](classes.selected);
        };
        addEventListener(content, 'keyup', handler);
        addEventListener(content, 'mouseup', handler);
        addEventListener(button, 'click', handler);
      }
      appendChild(actionbar, button);
    });

    if (settings.defaultParagraphSeparator) {
      exec(defaultParagraphSeparatorString, defaultParagraphSeparator);
    }

    return settings.element;
  };

  exports.exec = exec;
  exports.init = init;
})));
`;
