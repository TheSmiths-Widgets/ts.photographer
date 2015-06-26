var _DENSITY = (OS_ANDROID) ? Ti.Platform.displayCaps.logicalDensityFactor : 1,
    _STATES = { INIT: 1, NORMAL: 2, DISCARDED: 3 },
    _config,
    _styles,
    _animator;

function _log(type, message) {
    Ti.API[type](WPATH("").replace("/", "") + ": " + message);
}

function _onTouchStart (e) {
    /* Request token for the animation */
    if ($.thumbnails.children.length === 0 || !_animator.requestToken()) { return; }
    $.behindPreview.removeEventListener('touchmove', _onTouchStart);

    var ref = { x: e.x, y: e.y }, 
        lastRatio = 1,
        onTouchMove,
        onTouchEnd;

    /* Handle the drag while the user is moving its finger */
    onTouchMove = _.throttle(function onTouchMove(e) {
        /* Update last ratio */
        lastRatio = _animator.stepDragAnimation(ref, e);
    }, 50); /* The throttle delay required for Android */
    
    /* Also, we'll bind a listener at the end to either recover a consistent state if nothing
     * happend or ask the user to discard the picture */
    onTouchEnd = function onTouchEnd() {
        /* Remove the listener on touch move, we no longer want to move that picture */
        $.behindPreview.removeEventListener("touchmove", onTouchMove);
        $.behindPreview.removeEventListener("touchend", onTouchEnd);
            
        /* Replace the view and re-bind the initial event*/
        var reset = function reset() {
            /* Recover a consistent about the picture position and effects */
            _animator.rewindPreview(100);

            /* Let's use a little delay to replace the picture again and re-open the listener on
             * touch move. The re-call of replacePreview is sometimes needed because the touchmove
             * event might be triggered again after the end */
            _.delay(function () {
                _animator.rewindPreview(0);
                $.behindPreview.addEventListener("touchmove", _onTouchStart);
                _animator.releaseToken();
            }, 100);
        };

        /* Remove the picture from the preview view and the thumbnail bar */
        var discard = function discard () {
            /* When the discard button is hit (which is now an undo button :/), let's re-add the
             * previously discarded picture */
            $.discardIcon.backgroundImage = _config.undoIcon;
            $.discardIcon.touchEnabled = true;
            $.discardIcon.addEventListener("singletap", _onUndo); 

            /* Remove the image from the bar, and destroy the preview. However, a reference to the
             * image is still accessible via $.preview.thumbnail and will be used to be recoverd
             * from an undo. */
            $.thumbnails.remove($.preview.thumbnail);
            $.preview.image = null;
            $.preview._state = _STATES.DISCARDED;
            _animator.rewindPreview(0);

            /* Let's add an null thumbnail to force a resize */
            _animator.addThumbnail(null, _animator.releaseToken);
        };
        
        /* Ask for a discard confirmation only if the picture have been moved enough */
        lastRatio < 0.30 ? _confirmDiscard().then(discard, reset) : reset();
    };

    $.behindPreview.addEventListener("touchmove", onTouchMove); 
    $.behindPreview.addEventListener("touchend", onTouchEnd);
}

function _onUndo() {
    _addThumbnail($.preview.thumbnail);
}; 

function _confirmDiscard() {
    var discardDialog, then;
        
    discardDialog = Ti.UI.createAlertDialog({
        title: _config.discardConfirmTitle,
        buttonNames: [_config.discardConfirmButtonDiscard, _config.discardConfirmButtonCancel],
        cancel: 1,
        message: _config.discardConfirmMessage,
    });

    return {
        then: function then(onConfirm, onCancel) {
            discardDialog.addEventListener("click", function onConfirmDiscardClick(e) {
                e.index === discardDialog.cancel ? onCancel() : onConfirm();
            });
            discardDialog.show();
        }
    };
}
/* Add The thumbnail to the bar, remove the focus on the previous active thumbnail 
 * and give it to the new one */
function _addThumbnail (thumbnail) {
    if (!_animator.requestToken()) { return setTimeout(_addThumbnail, 25); }
    var done = _.after(2, _animator.releaseToken);

    $.preview.thumbnail && $.preview.thumbnail.removeFocus();
    thumbnail.focus(done);
    _animator.addThumbnail(thumbnail, done);  
}

var _takePicture = _.debounce(function takePicture() {
    _animator.showLoader();
    Ti.Media.showCamera({
        success: function(mediaItem) {
            if (mediaItem.mediaType === Ti.Media.MEDIA_TYPE_PHOTO) { 
                /* As we are gonna store all pictures in memory, we need to resize them to a lower
                 * resolution to prevent the app from memory overflow */
                var resolution = Math.max(mediaItem.media.width * mediaItem.media.height / (1024 * 1024), _config.maxResolution);
                    width = Math.floor(mediaItem.media.width * Math.sqrt(_config.maxResolution / resolution)),
                    height = Math.floor(mediaItem.media.height * Math.sqrt(_config.maxResolution / resolution)),
                    picture = mediaItem.media.imageAsResized(width, height);
                    thumbnail = $.UI.create('ImageView', { image: picture });

                thumbnail.applyProperties(_styles.thumbnail);

                /* Extend the thumbnail behavior */
                thumbnail.removeFocus = function removeFocus() {
                    this.applyProperties(_styles.inactive);
                };
    
                thumbnail.focus = function focus(focusDone) {
                    this.applyProperties(_styles.active);
                    $.preview.thumbnail = this;

                    /* In case where we've removed the event because there was no picture to move */
                    if ($.preview._state !== _STATES.NORMAL) {
                        $.behindPreview.addEventListener("touchmove", _onTouchStart);
                    }

                    _animator.changePreview(this.image, focusDone);
                };

                /* Give the focus on a single tap */
                thumbnail.addEventListener("singletap", function changeActiveThumbnail() {
                    if (this !== $.preview.thumbnail && _animator.requestToken()) {
                        $.preview.thumbnail.removeFocus();
                        this.focus(function () {
                            _animator.releaseToken();   
                        });
                    }
                });

                /* Done with the loader, add the thumbnail */
                _animator.hideLoader();
                _addThumbnail(thumbnail);
            }
        },

        error: function(e) {
            _animator.hideLoader();
            _config.onError(e);
        },

        cancel: function() {
            _animator.hideLoader();
        }
    });
}, 750, true); /* debounce with leading-edge */

var _init = function init(options) {
    var idealHeight = parseInt(Math.pow(Ti.Platform.displayCaps.platformWidth, 2) / 
        (Ti.Platform.displayCaps.platformHeight * _DENSITY), 10);

    _styles = {
        active: $.createStyle({ classes: 'active' }),
        inactive: $.createStyle({ classes: 'inactive' }),
        thumbnail: $.createStyle({ classes: 'thumbnail' }),
        loader: $.createStyle({ classes: 'loader' })
    };

    /* Merge the configuration with the default one */
    _config = {
        noPreviewBackgroundColor: "#ECF0F1",
        noPreviewIcon: WPATH("picture.png"),
        previewHeight: idealHeight, 
        thumbnailSize: idealHeight / 4,
        thumbnailSelectedBorderColor: "#F1C40F",
        thumbnailBarBackgroundColor: "#FFFFFF",
        
        addIcon: WPATH("add.png"),
        addBackgroundColor: "#161616",
        delimiterColor: "#161616",

        discardBackgroundColor: "#E74C3C",
        discardIcon: WPATH("trash.png"),
        discardConfirmTitle: "Hold on!",
        discardConfirmMessage: "Discard the picture?",
        discardConfirmButtonDiscard: "Discard",
        discardConfirmButtonCancel: "Cancel",

        undoIcon: WPATH("undo.png"),

        maxResolution: 0.75,

        onError: function (errorMessage) {
            _log('error', errorMessage);
        }
    };

    _.extend(_config, _.pick(options, _.keys(_config)));

    /* Apply the config to styles and UI elements */
    /* Preview element */
    $.preview.image = _config.noPreviewIcon;
    $.preview.height = _config.previewHeight / 2;
    $.preview.top = _config.previewHeight / 4;
    $.preview._state = _STATES.INIT;
    delete _config.noPreviewIcon; // Not Needed Anymore;
        
    /* Discard element */
    $.discardIcon.height = _config.previewHeight / 4;
    $.discardIcon.width = _config.previewHeight / 4;
    $.discardIcon.top = 3 * _config.previewHeight / 8;
    $.discardIcon.backgroundImage = _config.discardIcon;
    $.behindPreview.backgroundColor = _config.noPreviewBackgroundColor;
    $.behindPreview.zIndex = $.preview.zIndex - 1;
    $.behindPreview.height = _config.previewHeight;

    /* Thumbnails */
    _styles.active.borderColor = _config.thumbnailSelectedBorderColor;
    _styles.thumbnail.height = _styles.thumbnail.width = _config.thumbnailSize;
    delete _config.thumbnailSelectedBorderColor; // Not Needed Anymore

    $.thumbnails.height = _config.thumbnailSize;
    $.thumbnails.contentHeight = _config.thumbnailSize;
    $.bar.height = _config.thumbnailSize;
    $.bar.backgroundColor = _config.thumbnailBarBackgroundColor;
    $.delimiter.bottom = _config.thumbnailSize;
    $.delimiter.backgroundColor = _config.delimiterColor;
    delete _config.thumbnailBarBackgroundColor; // Not Needed Anymore
    delete _config.delimiterColor; // Not Needed Anymore

    /* Add Button */
    $.addContainer.height = _config.thumbnailSize;
    $.addContainer.width = _config.thumbnailSize;
    $.addContainer.backgroundColor = _config.addBackgroundColor;
    $.add.backgroundImage = _config.addIcon;
    $.add.width = _config.thumbnailSize / 3;
    $.add.height = _config.thumbnailSize / 3;
    delete _config.addIcon; // Not Needed Anymore
    delete _config.addBackgroundColor; // Not Needed Anymore

    /* Main container */
    $.container.height = _config.thumbnailSize + _config.previewHeight;
   
    /* Initialize animations */
    if (options.animations && options.animations.length > 0) {
        for (var i = 0, animation; animation = options.animations[i]; ++i) {
            _animator.registerAnimation(animation); 
        }
    } else {
        _log('warn', ": No animation registered");
    }

    /* Configure animations */
    _.each(_.pick(options, _animator.exportSettingsKeys()), function (value, name) {
        _animator.configureAnimation(name, value);
    });

    /* Finally, add a behavior on the add button */
    $.addContainer.addEventListener("singletap", _takePicture);

    /* Remove from the memory everything that is not required anymore */
    _init = function () {};
    delete _animator.exportSettingsKeys;
    delete _animator.exportAnimationKeys;
    delete _animator.configureAnimation;
    delete _animator.registerAnimation;
}

function cleanUp() {
    //!TODO
}

function _retrievePictures() {
    return _.map($.thumbnails.children, function (thumbnail) {
        return thumbnail.image;
    });
}

/* In charge of handling any animation; So that we can switch easily between animations without
 * breaking the rest of the code. This not aims at being decorrelated from the controller and
 * therefore, the animator is highly linked to the controller. */
_animator = (function createAnimator() {
    var __animationToken = "FREE", // Semaphore to ensure one animation is executed at a time
        __changeAnimation = "noAnimation",
        __addAnimation = "noAnimation",
        __loader = null,
        __loaderBackground = null,
        __discardAnimations = [],
        __api = {},
        __changeHandlers = {},
        __addHandlers = {},
        __animationSettings = {
            fadeDuration: 400,
            scaleIntensity: 1,
            rotateIntensity: 1,
            fadeIntensity: 1,
            shiftDuration: 500
        },
        __animationTypes = {
            CHANGE_NO_ANIMATION: "noAnimation",
            CHANGE_FADEOUT: "withFade",

            DISCARD_SCALEDOWN: 1,
            DISCARD_ROTATE: 2,
            DISCARD_SWIPE_VERTICAL: 3,
            DISCARD_SWIPE_HORIZONTAL: 4,
            DISCARD_FADEOUT: 5,

            ADD_NO_ANIMATION: "noAnimation",
            ADD_SMOOTH: "withShift"
        };

    /* --------------- CHANGING THE PREVIEW --------------- *
    *  All handlers related to concerning changing the preview image of the widget  
    * */
    function __beforeChange(newPreview, callback) {
        /* Ensure styles are correct before changing */
        $.behindPreview.backgroundColor = $.preview._state !== _STATES.DISCARDED ? 
            "transparent" : _config.discardBackgroundColor;
        $.behindPreview.zIndex = $.preview.zIndex + 1;
        $.behindPreview.image = $.preview.image;

        if ($.preview._state === _STATES.INIT) {
            /* This may happen at the very beginning, when no picture at all have been taken */
            $.behindPreview.image = null;
            $.preview.image = null;
            $.preview.top = 0;
            $.preview.height = _config.previewHeight;
            $.preview.width = Ti.UI.FILL;
            delete _config.previewHeight; // Not Needed Anymore 
        }

        if ($.preview._state === _STATES.DISCARDED) {
            /* This happens only after an image has been deleted. Now, we recover the initial
             * behavior for the undo button. There is no preview image, so we can't preload it in
             * background. */
            $.discardIcon.touchEnabled = false;
            $.discardIcon.removeEventListener("singletap", _onUndo);
        }

        /* on Android, we wait for the load event that is not triggered on iOS */
        if (newPreview !== null && OS_ANDROID) {
            $.preview.addEventListener('load', function onPreviewLoad() {
                $.preview.removeEventListener('load', onPreviewLoad);
                callback();
            });
        } else {
            _.delay(function () {
                callback();   
            }, 100);
        }
        _.delay(function () {
            $.preview.image = newPreview;
        }, 50);
    };

    function __afterChange(callback) {
        /* Restore the background in discard mode */
        $.behindPreview.opacity = 0;
        $.behindPreview.zIndex = $.discardIcon.zIndex - 1;
        $.behindPreview.backgroundColor = _config.discardBackgroundColor;
        $.behindPreview.image = null;
        $.preview._state = _STATES.NORMAL;
        $.discardIcon.backgroundImage = _config.discardIcon;
        callback();

        _.delay(function () {
            $.behindPreview.opacity = 1;
        }, 50);
    }

    __changeHandlers.noAnimation = function noAnimation(newPreview, callback) {
        __beforeChange(newPreview, function () {
            __afterChange(callback);
        });
    };

    __changeHandlers.withFade = function withFade(newPreview, callback) {
        __beforeChange(newPreview, function () {
            $.behindPreview.animate({
                opacity: 0,
                duration: __animationSettings.fadeDuration
            }, function afterFadeOut() {
                __afterChange(callback);
            });
        });
    };

    /* --------------- ADDING A THUMBNAIL ---------------
     * All handlers related to adding a thumbnail to the bar 
     * */
    __addHandlers.noAnimation = function noAnimation(thumbnail, callback) {
        if (thumbnail !== null) { $.thumbnails.add(thumbnail); }
        $.thumbnails.width = __computeThumbnailsWidth();
        $.thumbnails.scrollTo(__computeScrollOffset(), 0);
        callback();
    };

    __addHandlers.withShift = function withShift(thumbnail, callback) {
        if (OS_IOS) { return __addHandlers.noAnimation(thumbnail, callback); }

        if (thumbnail !== null) { $.thumbnails.add(thumbnail); }
        _.defer(function () { 
            $.thumbnails.animate({
                width: __computeThumbnailsWidth(),
                duration: __animationSettings.shiftDuration
            }, function afterResize() {
                $.thumbnails.scrollTo(__computeScrollOffset(), 0);
                callback();
            });
        });
    };

    /* Helpers: Compute the width of the thumbnail bar */
    function __computeThumbnailsWidth() {
        var maxSize = Ti.Platform.displayCaps.platformWidth / _DENSITY - _config.thumbnailSize,
            length = $.thumbnails.children.length,
            size = _config.thumbnailSize;

        return Math.min(length * size, maxSize);
    }

    /* Helper: Get The scroll offset to apply when the thumbnail bar is full-width */
    function __computeScrollOffset() {
        var n = $.thumbnails.children.length,
            h = _config.thumbnailSize,
            w = $.thumbnails.width,
            offset = OS_ANDROID ? _DENSITY * n * h : Math.max(0, n * h - w);

        return offset;
    }

    /* ------------- DISCARD THE PREVIEW --------------- */
    __api = {
        requestToken: function requestToken () {
            if (__animationToken === "FREE") {
                __animationToken = "TAKEN";
                return true;
            } 
            return false;
        },

        releaseToken: function releaseToken () {
            __animationToken = "FREE"; 
        },

        registerAnimation: function registerAnimation(animation) {
            if (__animationTypes[animation] === undefined) {
                return _log('error', "The animation '" + animation + "' does not exist.");
            }
            if (animation.match(/^CHANGE/)) {
                __changeAnimation = __animationTypes[animation];
            } else if (animation.match(/^ADD/)) {
                __addAnimation = __animationTypes[animation];
            } else {
                __discardAnimations.push(__animationTypes[animation]);
            }
        },

        configureAnimation: function configureAnimation(name, value) {
            if (__animationSettings[name] === undefined) {
                return _log('error', "Invalid setting name '" + name + "'; configuration aborted");
            }

            if (value.match(/^LOW|NORMAL|HIGH$/) === null) {
                return _log('error', "Invalid value '" + value + "' for the setting " + name);
            }

            /* We don't need to store all the settings in memory */
            __animationSettings[name] = {
                fadeDuration: { LOW: 750, NORMAL: 400, HIGH: 200 },
                scaleIntensity: { LOW: 0.4, NORMAL: 1, HIGH: 1.6 },
                rotateIntensity: { LOW: 0.5, NORMAL: 1, HIGH: 2 },
                fadeIntensity: { LOW: 0.25, NORMAL: 1, HIGH: 2 },
                shiftDuration: { LOW: 1000, NORMAL: 500, HIGH: 250 }
            }[name][value];
        },

        exportAnimationKeys: function exportAnimationKeys() {
            var keys = _.keys(__animationTypes);
            return _.object(keys, keys);
        },

        exportSettingsKeys: function exportSettingsKeys() {
            return _.keys(__animationSettings);
        },

        changePreview: function changePreview(newPreview, callback) {
            __changeHandlers[__changeAnimation](newPreview, callback);
        },

        addThumbnail: function addThumbnail(thumbnail, callback) {
            __addHandlers[__addAnimation](thumbnail, callback);
        },

        stepDragAnimation: function __stepDragAnimation(ref, e) {
            var deviation, ratio, distortOptions, translation, transformMatrix,
                sd = __discardAnimations.indexOf(__animationTypes.DISCARD_SCALEDOWN) !== -1,
                ro = __discardAnimations.indexOf(__animationTypes.DISCARD_ROTATE) !== -1,
                sv = __discardAnimations.indexOf(__animationTypes.DISCARD_SWIPE_VERTICAL) !== -1,
                sh = __discardAnimations.indexOf(__animationTypes.DISCARD_SWIPE_HORIZONTAL) !== -1,
                fo = __discardAnimations.indexOf(__animationTypes.DISCARD_FADEOUT) !== -1;

            deviation = { x: (e.x - ref.x) / _DENSITY, y: (e.y - ref.y) / _DENSITY };

            ratio = {
                x: 0.95 * Math.max(1 - Math.abs(deviation.x) / (1 + e.source.rect.width), 0.025),
                y: 0.95 * Math.max(1 - Math.abs(deviation.y) / (1 + e.source.rect.height), 0.025)
            };

            /* Compute the opacity if fadeout */
            if (fo) {
                $.preview.opacity = Math.pow(((sh && ratio.x || 1) + (sv && ratio.y || 1)) / 2,
                    __animationSettings.fadeIntensity);
            }

            /* Now, apply the transformations, if any */
            if (ro || sd || sh || sv) {
                distortOptions = {};

                /* Rotate if rotate setting; Depends of the swipe type, the rotation will be related to
                 * the corresponding gesture. If both swipe vertical and horizontal are supplied, x will
                 * prevail */
                if (ro) {
                    if (sh || !sv && !sh) {
                        distortOptions.rotate = Math.floor(90*(1-ratio.x)) * (e.x < ref.x ? -1 : 1);
                    } else {
                        distortOptions.rotate = Math.floor(90*(1-ratio.y)) * (e.y < ref.y ? -1 : 1);
                    }
                    distortOptions.rotate *= __animationSettings.rotateIntensity;
                }            

                /* Scale down if scaledown setting; Depends of the swipe type, the scale will be related
                 * to the corresponding ratio (x or y) */
                if (sd) { 
                    distortOptions.scale = (sv && !sh && ratio.y) || (sh && !sv && ratio.x) || ratio.x * ratio.y;
                    distortOptions.scale = Math.pow(distortOptions.scale, __animationSettings.scaleIntensity);
                }

                transformMatrix = Ti.UI.create2DMatrix(distortOptions);

                /* Translate if translate setting. Depends of the swipe type. */
                if (sv || sh) {
                    translation = {
                        x: sh && 0.9 * deviation.x * _DENSITY || 0,
                        y: sv && 0.9 * deviation.y * _DENSITY || 0
                    };

                    /* The way iOS and Android use the transform matrix is different, a matrix product is
                     * needed on iOS for the translation as the base may have changed due to the rotation */
                    if (OS_IOS) { 
                        transformMatrix = transformMatrix.multiply(Ti.UI.create2DMatrix()
                            .translate(translation.x, translation.y));
                    } else if (OS_ANDROID) {
                        transformMatrix = transformMatrix.translate(translation.x, translation.y);
                    }
                }
                
                $.preview.transform = transformMatrix;
            }

            /* Finally, return the current progress */
            return (sh && sv && Math.min(ratio.x, ratio.y)) || (sh && ratio.x) || ratio.y;
        },

        rewindPreview: function rewindPreview (duration) {
            if (duration === 0) {
                $.preview.opacity = 1;
                $.preview.transform = Ti.UI.create2DMatrix();
            } else {
                $.preview.animate(Ti.UI.createAnimation({
                    transform: Ti.UI.create2DMatrix(),
                    opacity: 1,
                    duration: duration
                }));
            }
        },

        showLoader: function showLoader() {
            __loader = Ti.UI.createActivityIndicator(); // iOS weirdly require that... can't use Alloy method.
            __loader.applyProperties(_styles.loader);
            __loaderBackground = $.UI.create("View", { id: "loaderBackground" });

            $.container.add(__loader);
            $.container.add(__loaderBackground);
            __loader.show();
        },


        hideLoader: function hideLoader() {
            if (__loader !== null) {
                __loader.animate({
                    opacity: 0,
                    duration: 100
                }, function () {
                    $.container.remove(__loader);
                    __loader = null;
                });
            }

            if (__loaderBackground !== null) {
                __loaderBackground.animate({
                    opacity: 0,
                    duration: 100
                }, function () {
                    $.container.remove(__loaderBackground);
                    __loaderBackground = null;
                });
            }
        }
    };

    _.extend(__api, __animationTypes);
    return __api;
}());




/* ------------------ PUBLIC API ----------------------- */
_.extend(exports, _animator.exportAnimationKeys());
exports.NORMAL = "NORMAL";
exports.SLOW = exports.LOW = "LOW";
exports.QUICK = exports.HIGH = "HIGH";
exports.init = _init;
exports.retrievePictures = _retrievePictures;
