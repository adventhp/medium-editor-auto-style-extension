var XRegExp = require('xregexp');

var AutoStyleExtension = MediumEditor.Extension.extend({
  // This config is here for documentary reasons.
  // It will be overwritten upon initialization of AutoStyleExtension.
  config: {
    sectionA: {
      matchcase: false,
      wordsonly: false,
      class: 'red-border',
      words: ['yellöw']
    },
    sectionB: {
      matchcase: true,
      wordsonly: true,
      style: 'color:green;background-color:red;',
      words: ['RED']
    },
    sectionC: {
      matchcase: false,
      wordsonly: false,
      style: 'background-color:gray;',
      words: ['gray', 'grey']
    },
    sectionD: {
      matchcase: true,
      wordsonly: true,
      style: 'background-color:orange;',
      words: ['oraNGE']
    }
  },
  setConfig: function(config) {
    this.config = config;
  },
  getConfig: function() {
    return this.config;
  },
  removeConfigSection: function(sectionName) {
    delete this.config[sectionName];
    this.processConfig();
  },
  setConfigSection: function(sectionName, sectionObject) {
    this.config[sectionName] = sectionObject;
    this.processConfig();
  },
  processConfig: function() {
    this.regexColors = [];
    var sectionKeys = Object.keys(this.config);

    for (var k = 0; k < sectionKeys.length; k++) {
      var sectionKey = sectionKeys[k];
      var section = this.config[sectionKey];
      var matchcase = section.matchcase === true ? 'g' : 'gi';
      var wordsonly =
        section.wordsonly === true ? ['(^|\\PL)', '(\\PL|$)'] : ['', ''];
      var words =
        wordsonly[0] + '(' + section.words.join('|') + ')' + wordsonly[1];

      this.regexColors.push({
        style: section.style,
        clazz: section.class,
        regex: new XRegExp(words, matchcase),
        regexPlain: section.words.join('|')
      });
    }
  },

  applyStyles: function() {
    this.getEditorElements().forEach(function(el) {
      // Cursor position wrong, if div is empty: after the first
      // typed word, the cursor jumps to the beginning of the word
      // (position = 0). Instead cursor position should be after the
      // word.
      var sel = this.base.exportSelection();
      var res = this.performStyling(el);
      var doc = this.base.options.contentWindow;
      var parent = this.base.getFocusedElement();
      var selection = doc.getSelection();
      if (selection && selection.rangeCount > 0) {
        var range = selection.getRangeAt(0);
        if (
          range &&
          range.startContainer &&
          range.startContainer.nodeName.toLowerCase() === 'tr'
        ) {
          return false; // disable on tr elements
        }
      } else {
        setTimeout(() => this.applyStyles(), 200);
      }
      if (sel && !sel.emptyBlocksIndex && range && range.endContainer) {
        var children =
          range.endContainer && range.endContainer.wholeText
            ? range.endContainer.wholeText.toLowerCase().split(' ')
            : [];
        var lastChild = children[children.length - 1];
        if (
          lastChild &&
          lastChild.toLowerCase() === 'br' &&
          children.filter(function(node) {
            return node === 'br';
          }).length > 1
        ) {
          return;
        } else if (
          range.endContainer === parent.lastChild &&
          range.endContainer.textContent.length === 0
        ) {
          return;
        }
      }
    }, this);
  },
  disableEventHandling: undefined,
  regexColors: [],
  init: function() {
    MediumEditor.Extension.prototype.init.apply(this, arguments);
    if (this.disableEventHandling === undefined) {
      this.disableEventHandling = true;
    }

    this.processConfig();
    this.applyStyles();

    this.subscribe('editableKeypress', this.onKeypress.bind(this));
    this.subscribe('editableBlur', this.onBlur.bind(this));
  },

  onBlur: function(blurEvent, editable) {
    if (this.disableEventHandling) {
      return;
    }
    this.performStyling(editable);
  },

  onKeypress: function(keyPressEvent) {
    if (
      MediumEditor.util.isKey(keyPressEvent, [
        MediumEditor.util.keyCode.TAB,
        MediumEditor.util.keyCode.DELETE,
        MediumEditor.util.keyCode.SPACE,
        MediumEditor.util.keyCode.ENTER
      ])
    ) {
      clearTimeout(this.performStylingTimeout);
      // Saving/restoring the selection in the middle of a keypress doesn't work well...
      this.performStylingTimeout = setTimeout(
        function() {
          try {
            var sel = this.base.saveSelection();
            if (this.performStyling(keyPressEvent.target)) {
              // pass true for favorLaterSelectionAnchor - this is needed for links at the end of a
              // paragraph in MS IE, or MS IE causes the link to be deleted right after adding it.
              this.base.restoreSelection();
            }
          } catch (e) {
            if (window.console) {
              window.console.error('Failed to perform styling', e);
            }
            this.disableEventHandling = true;
          }
        }.bind(this),
        0
      );
    }
  },

  performStyling: function(contenteditable) {
    /*
        Perform styling on blockElement basis, blockElements are HTML elements with text content and without
        child element.
        Example:
        - HTML content
        <blockquote>
          <p>link.</p>
          <p>my</p>
        </blockquote>
        - blockElements
        [<p>link.</p>, <p>my</p>]
        otherwise the detection can wrongly find the end of one paragraph and the beginning of another paragraph
        to constitute a link, such as a paragraph ending "link." and the next paragraph beginning with "my" is
        interpreted into "link.my" and the code tries to create a link across blockElements - which doesn't work
        and is terrible.
        (Medium deletes the spaces/returns between P tags so the textContent ends up without paragraph spacing)
        */
    var blockElements = MediumEditor.util.splitByBlockElements(contenteditable),
      documentModified = false;

    if (blockElements.length === 0) {
      blockElements = [contenteditable];
    }
    for (var i = 0; i < blockElements.length; i++) {
      documentModified =
        this.unwrapAutoStyleSpans(blockElements[i]) || documentModified;
      documentModified =
        this.performStylingWithinElement(blockElements[i]) || documentModified;
    }
    this.base.events.updateInput(contenteditable, {
      target: contenteditable,
      currentTarget: contenteditable
    });
    return documentModified;
  },

  unwrapAutoStyleSpans: function(element) {
    if (!element || element.nodeType === 3) {
      return false;
    }

    var spans = element.querySelectorAll('span[data-auto-style="true"]'),
      documentModified = false;

    for (var i = 0; i < spans.length; i++) {
      MediumEditor.util.unwrap(spans[i], this.document);
      documentModified = true;
    }

    return documentModified;
  },

  performStylingWithinElement: function(element) {
    var matches = this.findStyleableText(element),
      linkCreated = false;

    for (var matchIndex = 0; matchIndex < matches.length; matchIndex++) {
      var matchingTextNodes = MediumEditor.util.findOrCreateMatchingTextNodes(
        this.document,
        element,
        matches[matchIndex]
      );
      this.createAutoStyle(
        matchingTextNodes,
        matches[matchIndex].style,
        matches[matchIndex].clazz
      );
    }
    return linkCreated;
  },

  hashArr: [],

  checkHash: function(hash) {
    if (this.hashArr.indexOf(hash) > -1) {
      return false;
    } else {
      this.hashArr.push(hash);
    }
    return true;
  },

  findStyleableText: function(contenteditable) {
    this.hashArr = [];
    var textContent = contenteditable.textContent,
      match = null,
      matches = [];

    if (textContent.length > 0) {
      for (var i = 0; i < this.regexColors.length; i++) {
        var rc = this.regexColors[i];
        var style = rc.style;
        var clazz = rc.clazz;
        var regex = rc.regex;
        var regexPlain = rc.regexPlain;
        var pos = 0;

        while ((match = XRegExp.exec(textContent, regex, pos)) !== null) {
          pos = match.index + 1;

          if (match.length === 2) {
            // wordsonly: false
            // HACK!
            if (match[0] === '') continue;
            var matchEnd = match.index + match[0].length;
            var hash = match.index + '-' + matchEnd;
            if (this.checkHash(hash)) {
              matches.push({
                word: match[0],
                clazz: clazz,
                style: style,
                start: match.index,
                end: matchEnd
              });
            }
          } else if (match.length === 4) {
            // wordsonly: true
            // HACK!
            if (match[2] === '') continue;
            var start = match.index + match[1].length;
            var matchEnd = start + match[2].length;
            var hash = start + '-' + matchEnd;
            if (this.checkHash(hash)) {
              matches.push({
                word: match[2],
                clazz: clazz,
                style: style,
                start: start,
                end: matchEnd
              });
            }
          } else {
            if (window.console) {
              window.console.error('Cannot process: ' + match);
            }
          }
        }
      }
    }

    return matches;
  },

  createAutoStyle: function(textNodes, style, clazz) {
    var node = MediumEditor.util.traverseUp(textNodes[0], function(node) {
      var ret;
      if (
        node.nodeName.toLowerCase() === 'span' &&
        node.getAttribute &&
        node.getAttribute('data-auto-style') === 'true'
      ) {
        ret = node;
      }
      return ret;
    });

    if (node !== false) {
      if (style !== undefined) {
        if (node.getAttribute('style') === null) {
          node.setAttribute('style', style);
        } else {
          var s = node.getAttribute('style');
          node.setAttribute('style', style + ';' + s);
        }
      }
      if (clazz !== undefined) {
        node.className += ' ' + clazz;
      }
      node.setAttribute('data-auto-style', 'true');
    } else {
      node = this.document.createElement('span');
      MediumEditor.util.moveTextRangeIntoElement(
        textNodes[0],
        textNodes[textNodes.length - 1],
        node
      );
      if (style !== undefined) {
        node.setAttribute('style', style);
      }
      if (clazz !== undefined) {
        node.className += clazz;
      }
      node.setAttribute('data-auto-style', 'true');
    }
  }
});

try {
  window.AutoStyleExtension = AutoStyleExtension;
} catch (e) {
  // whatever
}

try {
  module.exports = AutoStyleExtension;
} catch (e) {
  // whatever
}
