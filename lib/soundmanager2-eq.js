function getEqualizerBands(channelData, options) {
    options = options === true ? { normalize: true, logarithmic: true } : options || {};

    function normalize(num, log) {
        var f = 3;
        return log
                ? (Math.exp(f * num) - 1) / (Math.exp(f * 7 / 5) - 1)
                : num * 5 / 7;
    }

    var bands = [];
    for(var i = 0; i < 8; i++) {
        var start = Math.pow(2, i) - 1;
        var end = start * 2 + 1;
        var sum = 0;
        for (var j = start; j < end; j++) {
            var val = parseFloat(channelData[j]);
            if (options.normalize)
                val = normalize(val, options.logarithmic);
            sum += val;
        }
        var avg = sum / (end - start);
        bands[i] = Math.sqrt(avg / Math.sqrt(2));
    }
    return bands;
}
