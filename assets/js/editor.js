// Install some useful jQuery extensions that we use a lot

$.extend($.fn, {
	modifyClass: function(className, add) {
		return this[add ? 'addClass' : 'removeClass'](className);
	},

	orNull: function() {
		return this.length > 0 ? this : null;
	},

	findAndSelf: function(selector) {
		return this.find(selector).add(this.filter(selector));
	}
});

function downloadDataUri(options) {
	if (!options.url)
		options.url = "http://download-data-uri.appspot.com/";
	$('<form method="post" action="' + options.url
		+ '" style="display:none"><input type="hidden" name="filename" value="'
		+ options.filename + '"/><input type="hidden" name="data" value="'
		+ options.data + '"/></form>').appendTo('body').submit().remove();
}

function createPaperScript(element) {
	var scriptName = 'paperjs_' + window.location.pathname.match(/\/([^\/]*)$/)[1],
		runButton = $('.button.run', element),
		canvas = $('canvas', element),
		showSplit = element.hasClass('split'),
		sourceFirst = element.hasClass('source'),
		consoleContainer = $('.console', element).orNull(),
		editor = null,
		session,
		tools = $('.tools', element),
		inspectorInfo = $('.toolbar .info', element),
		source = $('.source', element),
		code = localStorage[scriptName] || '',
		scope,
		customAnnotations = [],
		ignoreAnnotation = false;

	function showSource(show) {
		source.modifyClass('hidden', !show);
		runButton.text(show ? 'Run' : 'Source');
		if (show && !editor) {
			editor = ace.edit(source.find('.editor')[0]);
			editor.setTheme('ace/theme/bootstrap');
			editor.setShowInvisibles(false);
			editor.setDisplayIndentGuides(true);
			session = editor.getSession();
			session.setValue(code);
			session.setMode('ace/mode/javascript');
			session.setUseSoftTabs(true);
			session.setTabSize(4);
			session.on('change', function() {
			    localStorage[scriptName] = editor.getValue();
			});
			// We need to listen to changes in annotations, since the javascript
			// worker changes annotations asynchronously, and would get rid of
			// annotations that we added ourselves (customAnnotations)
			session.on('changeAnnotation', function() {
				if (!ignoreAnnotation && customAnnotations.length > 0)
					addAnnotations(customAnnotations);
			});
		}
	}

	function addAnnotations(list) {
		ignoreAnnotation = true;
		session.setAnnotations(session.getAnnotations().concat(list));
		ignoreAnnotation = false;
	}

	function removeAnnotations(list) {
		var annotations = session.getAnnotations();
		for (var i = annotations.length - 1; i >= 0; i--) {
			if (list.indexOf(annotations[i]) !== -1)
				annotations.splice(i, 1);
		}
		ignoreAnnotation = true;
		session.setAnnotations(annotations);
		ignoreAnnotation = false;
	}

	function evaluateCode() {
		scope.setup(canvas[0]);
		scope.evaluate(code);
		createInspector();
		setupTools();
	}

	function runCode() {
		removeAnnotations(customAnnotations);
		customAnnotations = [];
		code = editor.getValue();
		// In order to be able to install our own error handlers first, we are
		// not relying on automatic script loading, which is disabled by the use
		// of data-paper-ignore="true". So we need to create a new paperscope
		// each time.
		if (scope)
			scope.remove();
		scope = new paper.PaperScope();
		setupConsole();
		// parseInclude() triggers evaluateCode() in the right moment for us.
		parseInclude();
	}

	if (consoleContainer) {
		// Append to a container inside the console, so css can use :first-child
		consoleContainer = $('<div class="content"/>').appendTo(consoleContainer);
	}

	function setupConsole() {
		if (!consoleContainer)
			return;
		// Override the console object with one that logs to our new
		// console
		function print(className, args) {
			$('<div/>')
				.addClass(className)
				.text(paper.Base.each(args, function(arg) {
									this.push(arg + '');
								}, []).join(' '))
				.appendTo(consoleContainer);
			consoleContainer.scrollTop(consoleContainer.prop('scrollHeight'));
		}

		$.extend(scope, {
			console: {
				log: function() {
					print('line', arguments);
				},

				error: function() {
					print('line error', arguments);
				}
			}
		});
	}

	function clearConsole() {
		if (consoleContainer) {
			consoleContainer.children().remove();
		}
	}

	// Install an error handler to log the errors in our log too:
	window.onerror = function(error, url, lineNumber) {
		var columNumber = 0,
			match;
		if (match = error.match(/(.*)\s*\((\d*):(\d*)\)/)) { // Acorn
			error = match[1];
			lineNumber = match[2];
			columNumber = match[3];
		} else if (match = error.match(/(.*)Line (\d*):\s*(.*)/i)) { // Esprima
			error = match[1] + match[3];
			lineNumber = match[2];
		}
		if (lineNumber) {
			var annotation = { 
				row: lineNumber - 1, 
				column: columNumber, 
				text: error, 
				type: 'error'
			};
			addAnnotations([annotation]);
			customAnnotations.push(annotation);
			editor.gotoLine(lineNumber, columNumber);
		}
		scope.console.error('Line ' + lineNumber + ': ' + error);
		paper.view.draw();
	};

	function parseInclude() {
		var includes = [];
		// Parse code for includes, and load them synchronously, if present
		code.replace(/\binclude\(['"]([^)]*)['"]\)/g, function(all, url) {
			includes.push(url);
		});

		// Install empty include() function, so code can execute include()
		// statements, which we process separately above.
		scope.include = function(url) {
		};

		// Load all includes sequentially, and finally evaluate code, since 
		// the code will probably be interdependent.
		function load() {
			var url = includes.shift();
			if (url) {
				$.getScript(url, load);
			} else {
				evaluateCode();
			}
		}
		load();
	}

	var inspectorTool,
		prevSelection;

	function createInspector() {
		inspectorTool = new paper.Tool();
		inspectorTool.buttonTitle = '\x26';
		inspectorTool.buttonClass = 'tool-symbol';
		prevSelection = null;
		inspectorTool.attach({
			mousedown: function(event) {
				if (prevSelection) {
					prevSelection.selected = false;
				}
				var selection = event.item;
				if (selection) {
					var handle = selection.hitTest(event.point, {
						segments: true,
						tolerance: 4
					});
					if (handle) {
						selection = handle.segment;
					}
					selection.selected = true;
				}
				inspectorInfo.modifyClass('hidden', !selection);
				inspectorInfo.html('');
				if (selection) {
					var text;
					if (selection instanceof paper.Segment) {
						text = 'Segment';
						text += '<br />point: ' + selection.point;
						if (!selection.handleIn.isZero())
							text += '<br />handleIn: ' + selection.handleIn;
						if (!selection.handleOut.isZero())
							text += '<br />handleOut: ' + selection.handleOut;
					} else {
						text = selection.constructor._name;
						text += '<br />position: ' + selection.position;
						text += '<br />bounds: ' + selection.bounds;
					}
					inspectorInfo.html(text);
				}
				prevSelection = selection;
			},

			deactivate: function() {
				if (prevSelection)
					prevSelection.selected = false;
				prevSelection = null;
				inspectorInfo.addClass('hidden');
				inspectorInfo.html('');
				paper.view.draw();
			}
		});

		zoomTool = new paper.Tool();
		zoomTool.buttonTitle = '\x21';
		zoomTool.buttonClass = 'tool-symbol';
		zoomTool.attach({
			mousedown: function(event) {
				if (event.modifiers.space)
					return;
				var factor = 1.25;
				if (event.modifiers.option)
					factor = 1 / factor;
				paper.view.center = event.point;
				// paper.view.center = paper.view.center - event.point.subtract(paper.view.center) / factor;
				paper.view.zoom *= factor;
			},
			mousedrag: function(event) {
				if (event.modifiers.space) {
					paper.view.scrollBy(event.delta.negate());
				}
			},
			activate: function() {
				$('body').addClass('zoom');
			},
			deactivate: function() {
				$('body').removeClass('zoom');
			}
		});

	saveTool = new paper.Tool();
	saveTool.buttonTitle = 'Save';
	saveTool.attach({
		activate: function(prev) {
			setTimeout(function() {
				var svg = new XMLSerializer().serializeToString(paper.project.exportSvg());
				downloadDataUri({
					data: 'data:image/svg+xml;base64,' + btoa(svg),
					filename: 'export.svg'
				});
				prev.activate();
			}, 0);
		}
	});
	}

	function setupTools() {
		tools.children().remove();
		paper.tools.forEach(function(tool) {
			var title = tool.buttonTitle || '\x23',
				button = $('<div class="button">' + title + '</div>')
					.prependTo(tools);
			if (tool.buttonClass || !tool.buttonTitle)
				button.addClass(tool.buttonClass || 'tool-symbol');
			button.click(function() {
				tool.activate();
			}).mousedown(function() {
				return false;
			});
			tool.attach({
				activate: function() {
					button.addClass('active');
				},
				deactivate: function() {
					button.removeClass('active');
				}
			});
		});
		// Activate first tool now, so it gets highlighted too
		var tool = paper.tools[0];
		if (tool)
			tool.activate();
	}

	var panes = element.findAndSelf('.split-pane');
	panes.each(function() {
		var pane = $(this);
		pane.split({
			orientation: pane.attr('data-orientation') == 'hor' ? 'vertical' : 'horizontal',
			position: pane.attr('data-percentage'),
			limit: 100
		});
	});

	// Refresh editor if parent gets resized
	$('.editor', element).parents('.split-pane').on('splitter.resize', function() {
		editor.resize();
	});

	canvas.parents('.split-pane').on('splitter.resize', function() {
		var pane = $('.canvas', element);
		scope.view.setViewSize(pane.width(), pane.height());
	});

	function toggleView() {
		var show = source.hasClass('hidden');
		canvas.modifyClass('hidden', show);
		showSource(show);
		if (!show)
			runCode();
	}

	$(window).resize(function() {
		// Do not have .paperscript automatically resize to 100%, instead
		// resize it in the resize handler, for much smoother redrawing,
		// since the splitter panes are aligning using right: 0 / bottom: 0.
		element.width($(window).width()).height($(window).height());
		if (editor)
			panes.trigger('splitter.resize');
	}).trigger('resize');

	// Run the script once the window is loaded
	if (window.location.search != '?fix')
		$(window).load(runCode);

	if (showSplit) {
		showSource(true);
	} else if (sourceFirst) {
		toggleView();
	}

	$('.button', element).mousedown(function() {
		return false;
	});

	runButton.click(function() {
		if (showSplit) {
			runCode();
		} else {
			toggleView();
		}
		return false;
	});

	$('.button.clear-console', element).click(function() {
		clearConsole();
	});
}

$(function() {
	$('.paperscript').each(function() {
		createPaperScript($(this));
	});
	$(document).keydown(function(event) {
		if ((event.metaKey || event.ctrlKey) && event.which == 69) {
			$('.paperscript .button.run').trigger('click', event);
			return false;
		}
	});
});
