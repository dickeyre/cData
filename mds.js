import numeric from 'numeric';

/*
Taken from https://github.com/benfred/mds.js
Copyright (C) 2013 Ben Frederickson

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

const mds = {};

/// given a matrix of distances between some points, returns the
/// point coordinates that best approximate the distances using
/// classic multidimensional scaling
mds.classic = function (distances, dimensions) {
  dimensions = dimensions || 2;

  // square distances
  const M = numeric.mul(-0.5, numeric.pow(distances, 2));

  // double centre the rows/columns
  function mean(A) { return numeric.div(numeric.add.apply(null, A), A.length); }
  const rowMeans = mean(M);
  const colMeans = mean(numeric.transpose(M));
  const totalMean = mean(rowMeans);

  for (let i = 0; i < M.length; ++i) {
    for (let j = 0; j < M[0].length; ++j) {
      M[i][j] += totalMean - rowMeans[i] - colMeans[j];
    }
  }

  // take the SVD of the double centred matrix, and return the
  // points from it
  const ret = numeric.svd(M);
  const eigenValues = numeric.sqrt(ret.S);
  return ret.U.map(function (row) {
    return numeric.mul(row, eigenValues).splice(0, dimensions);
  });
};

export default mds;
