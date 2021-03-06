;(function ($, undefined) {
    "use strict";

    // Dependencies
    if ($ === undefined) {
        throw "jQuery should be defined to use liveSortable";
    }
    if (!("sortable" in $.fn)) {
        throw "jQuery UIs sortable should be defined to use liveSortable";
    }

    var pluginName = "liveSortable",
        pluginDataName = "plugin_" + pluginName;

    // LiveSortable Defaults
    var defaults = {
            // Realtime options
            cancelRealtime: false,
            cancelSendingInRealtime: false,

            // MouseMove event delay
            delay: 0,

            // Custom modificable events mostly used to send custom information in the socket
            events: {
                start: function() {},
                beforeStop: function() {},
                stop: function() {},
                mousemove: function() {}
            },

            // Default event names
            eventNames: {
                started: "move_started",
                moving : "moving_element",
                ended  : "move_ended"
            },

            // jQuery UI options
            sortable: {
                helper: "clone",
                start: function(event, ui) {
                    var liveSortable = LiveSortable.getInstanceFrom(this);
                    var socket = liveSortable.getSocket();

                    var data = liveSortable.events.start(event, ui, liveSortable) || { id: ui.item.get(0).id };

                    socket.emit( eventNamesFactory.addBroadcast(liveSortable.customEvents.started), data );

                    liveSortable.isBeingDragged = true;
                },
                beforeStop: function(event, ui) {
                    var liveSortable = LiveSortable.getInstanceFrom(this);
                    var socket = liveSortable.getSocket();
                    
                    var data = liveSortable.events.beforeStop(event, ui, liveSortable);

                    if(!data) {
                        // Provide the next and previous id of the element being dragged
                        var item = ui.item;
                        var next = item.next().get(0);
                        var prev = item.prev().get(0);
                        data = {
                            id:   item.get(0).id,
                            next: next && next.id,
                            prev: prev && prev.id
                        };
                    }

                    socket.emit( eventNamesFactory.addBroadcast(liveSortable.customEvents.ended), data );
                },
                stop: function(event, ui) {
                    var liveSortable = LiveSortable.getInstanceFrom(this);

                    liveSortable.events.stop(event, ui, liveSortable);

                    liveSortable.isBeingDragged = false;
                }
            }
        };

    /* ==============================================
        eventNamesFactory
       ============================================== */

    // Creates new event names in the plugin namespace 
    var eventNamesFactory = {
        sufix: "." + pluginName,
        addSufix: function(eventName) {
            return eventName + eventNamesFactory.sufix;
        },
        addBroadcast: function(eventName) {
            return "broadcast_" + eventName;
        },
        create: function(liveSortable) {
            var eventNames = { started: "", moving: "", ended: "" }

            $.each(eventNames, function(key, value) {
                eventNames[key] = eventNamesFactory.addSufix(liveSortable.options.eventNames[key] || defaults.eventNames[key]);
            });

            return eventNames;
        }
    };

    /* ==============================================
        SocketEventer Class
       ============================================== */

    // Class to handle the Socket events, add and remove them
    function SocketEventer(liveSortable) {
        var self = this;

        this.$element = liveSortable.$element;

        if(liveSortable.options.socket === undefined) {
            throw "A socket must be passed as an argument to use liveSortable.";
        }

        this.socket = liveSortable.options.socket;

        // Listen every event on the socket and trigger it on the stored element
        $.each(liveSortable.customEvents, function(key, customEvent) {
            // If realtime is canceled, skip the moving_element event
            if(liveSortable.options.cancelRealtime && key === "moving") {
                return;
            }

            self.addEvent( customEvent );
        });

        return this;
    }
    SocketEventer.prototype = {
        eventHandlers: {},
        addEvent: function(eventName) {
            // We support only a default handler (for now)
            var self = this;
            var handler = function(data) {
                self.$element.trigger(eventName, data);
            };

            this.eventHandlers[eventName] = handler;
            this.socket.on(eventName, handler);
        },
        removeEvent: function(eventName) {
            this.socket.removeListener(eventName, this.eventHandlers[eventName]);
        },
        removeAllEvents: function() {
            for(var event in this.eventHandlers) {
                if(this.eventHandlers.hasOwnProperty(event)) {
                    this.removeEvent(event);
                }
            }
        }
    };

    /* ==============================================
        LiveSortable Class
       ============================================== */

    function LiveSortable( element, options ) {
        this.$element = $(element);

        // Plugin defaults
        this.options = $.extend({}, defaults, options);

        // Custom events
        this.events = $.extend({}, defaults.events, this.options.events);

        // Sortable defaults
        this.sortableOptions = $.extend({}, defaults.sortable, this.options.sortable);

        // Start jqueryui sortable
        this.$element.sortable(this.sortableOptions);

        // Create the event names
        this.customEvents = eventNamesFactory.create(this);

        // Create a new (private) SocketEventer, and a getter for the socket itself
        this._socketEventer = new SocketEventer(this);
        this.getSocket = function() {
            return this._socketEventer.socket;
        };

        // Mousemove event
        if(!this.options.cancelSendingInRealtime) {
            this.addMousemoveHandler();
        }

        return this;
    }

    LiveSortable.prototype = {
        isBeingDragged: false,
        addMousemoveHandler: function() {
            var self = this;

            return this.$element.on(eventNamesFactory.addSufix("mousemove"), function(event) {
                if(self.isBeingDragged) {
                    var data = self.events.mousemove(event, self);

                    if(!data) {
                        var elem = self.$element.children(".ui-sortable-helper").get(0);
                        data = {
                            id:   elem.id,
                            top:  elem.style.top,
                            left: elem.style.left
                        };
                    }

                    self._socketEventer.socket.emit(eventNamesFactory.addBroadcast(self.customEvents.moving), data);

                    if(self.options.delay > 0) {
                        // This is not abstracted to a different function (sadly) so we retain the outer scope for the setTimeout // and "minimize" complexity for performance.
                        self.removeMousemoveHandler();
                        setTimeout(function() { self.addMousemoveHandler(); }, self.options.delay);
                    }
                }
            });
        },
        removeMousemoveHandler: function() {
            return this.$element.off(eventNamesFactory.addSufix("mousemove"));
        },
        remove: function() {
            this.$element.removeData(pluginDataName).off(eventNamesFactory.sufix);
            this._socketEventer.removeAllEvents();
            return this.$element;
        },
        toggleOption: function(option) {
            this.options[option] = !this.options[option]; 
            return this.options[option];
        },
        toggleRealtime: function() {
            var realtimeEventName = this.customEvents.moving;

            if( this.toggleOption("cancelRealtime") ) {
                this._socketEventer.removeEvent(realtimeEventName);
            } else {
                this._socketEventer.addEvent(realtimeEventName);
            }
        },
        toggleRealtimeSending: function() {
            if( this.toggleOption("cancelSendingInRealtime") ) {
                this.removeMousemoveHandler();
            } else {
                this.addMousemoveHandler();
            }
        },
        delay: function(time) {
            this.options.delay = time;
        }
    };

    LiveSortable.getInstanceFrom = function(element) {
        return $(element).data(pluginDataName);
    };

    /* ==============================================
        jQuery Plugin initialization
       ============================================== */

    $.fn[pluginName] = function ( options ) {
        var isMethod = typeof options === 'string';
        if(isMethod) {
            var methodArguments = Array.prototype.slice.call(arguments, 1);
        }

        return this.each(function() {
            // When the first argument is a string, call a method on the instance with that string as the method name
            // Otherwise instantiate the plugin
            if (isMethod) {
                var instance = $.data(this, pluginDataName);
                if (!instance) {
                    throw "Method called on liveSortable before instantiation";
                }
                if ( !$.isFunction(instance[options]) ) {
                    throw "The method: " + options + " was not found in liveSortable";
                }

                instance[options].apply(instance, methodArguments);
            } else {
                // Create only one instance
                if ( !$.data(this, pluginDataName) ) {
                    $.data(this, pluginDataName, new LiveSortable( this, options ));
                }
            }
        });
    };

})( jQuery );