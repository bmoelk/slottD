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
      icon: '&#128279;',
      title: 'Link',
      result: function() {
        var url = window.prompt('Enter link URL (https://...):');
        if (url) exec('createLink', url);
      }
    },
    image: {
      icon: '&#128444;&#65039;',
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
