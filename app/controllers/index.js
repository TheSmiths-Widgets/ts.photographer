$.photographer.init({
    fadeDuration: $.photographer.NORMAL,

    animations: [
        $.photographer.DISCARD_SWIPE_VERTICAL,
        $.photographer.DISCARD_ROTATE,
        $.photographer.ADD_SMOOTH,
        $.photographer.CHANGE_FADEOUT
    ]
});

function retrieve () {
    Ti.API.warn(JSON.stringify($.photographer.retrievePictures()));
}

$.index.open();
