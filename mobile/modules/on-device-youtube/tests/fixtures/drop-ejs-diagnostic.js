// Original Drop diagnostic input. This is not a YouTube player and does not
// test whether any current YouTube player can be decoded.
(function () {
  function DropProbe() {
    this.values = { n: '', s: '' };
  }

  DropProbe.prototype.set = function (key, value) {
    this.values[key] = value;
  };

  DropProbe.prototype.get = function (key) {
    return this.values[key] || null;
  };

  DropProbe.prototype.transform = function () {
    this.values.n = this.values.n.split('').reverse().join('');
  };

  function createDropProbe(url, signatureName, signature) {
    var marker = { set: function () {} };
    marker.set('alr', 'yes');
    var probe = new DropProbe();
    probe.values.s = signature || '';
    return probe;
  }
}).call(this);
