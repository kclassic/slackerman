const D3Node = require('d3-node');
const cloud = require('d3-cloud');
const Canvas = require('canvas');
const _ = require('lodash');
const d3 = D3Node.d3;

function getWordCloud(req, res) {
    const width = 800;
    const height = 600;

    const d3n = new D3Node();

    const words = require('./text.json').text.split(' ');
    const wordmap = processText(words);
    const svg = d3n.createSVG(width, height)
        .attr('xmlns', 'http://www.w3.org/2000/svg')
        .attr('xmlns:xlink', 'http://www.w3.org/1999/xlink');

    drawCloud(wordmap, width, height, svg, () => {
      res.send(d3n.svgString());
    });

}

function processText(text) {
    // const unique_word_counts = {};
    // const exclude = require('./excludes.json');
    //
    // const tokenized_text = text.split(/[ '\-()*':;[\]|{},.!?]+/);
    // tokenized_text.forEach(function(raw_word){
    //     const word = raw_word.toLowerCase();
    //     if (word != '' && !exclude.words.includes(word) && word.length>1){
    //         word in unique_word_counts ?
    //             unique_word_counts[word]++ :
    //             (unique_word_counts[word] = 1 + Math.random());
    //     }
    // });
    //
    // const wordmap = _.toPairs(unique_word_counts).sort(function(a,b){
    //     return b.value - a.value;
    // });
    const wordmap = _.map(text, d => {
      return {text: d, size: 10 + Math.random() * 90};
    });

    return wordmap;
}

function drawCloud(wordmap, width, height, svg, callback){
    const getRandomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    const fill = d3.scaleOrdinal(d3.schemeAccent);

    cloud().size([width, height])
      .canvas(() => new Canvas(1, 1))
      .words(wordmap)
      .padding(2)
      .rotate(() => getRandomInt(-2, 2) * 30)
      .font('Impact')
      .fontSize(d => d.size)
      .on('end', (words) => {
        svg
            .attr('width', width)
            .attr('height', height)
          .append('g')
            .attr('transform', 'translate(' + width / 2 + ',' + height / 2 + ')')
          .selectAll('text')
            .data(words)
          .enter().append('text')
            .style('font-size', (d) => { return d.size + 'px'; })
            .style('font-family', 'Impact')
            .attr('stroke', 'black')
            .attr('fill', () => fill(Math.random()))
            .attr('stroke-width', 1)
            .attr('text-anchor', 'middle')
            .attr('transform', (d) => {
              return 'translate(' + [d.x, d.y] + ')rotate(' + d.rotate + ')';
            })
            .text((d) => { return d.text; });
        callback();
      })
      .start();
}


module.exports = {
  getWordCloud,
}
