/*
    Copyright 2008-2013
        Matthias Ehmann,
        Michael Gerhaeuser,
        Carsten Miller,
        Bianca Valentin,
        Alfred Wassermann,
        Peter Wilfahrt

    This file is part of JSXGraph.

    JSXGraph is free software dual licensed under the GNU LGPL or MIT License.

    You can redistribute it and/or modify it under the terms of the

      * GNU Lesser General Public License as published by
        the Free Software Foundation, either version 3 of the License, or
        (at your option) any later version
      OR
      * MIT License: https://github.com/jsxgraph/jsxgraph/blob/master/LICENSE.MIT

    JSXGraph is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License and
    the MIT License along with JSXGraph. If not, see <http://www.gnu.org/licenses/>
    and <http://opensource.org/licenses/MIT/>.
 */


/*global JXG: true, define: true*/
/*jslint nomen: true, plusplus: true*/

/* depends:
 jxg
 base/constants
 base/coords
 base/element
 math/math
 math/geometry
 math/statistics
 math/numerics
 parser/geonext
 utils/type
  elements:
   transform
 */

/**
 * @fileoverview In this file the geometry element Curve is defined.
 */

define([
    'jxg', 'base/constants', 'base/coords', 'base/element', 'math/math', 'math/statistics', 'math/numerics',
    'math/geometry', 'parser/geonext', 'utils/type', 'base/transformation'
], function (JXG, Const, Coords, GeometryElement, Mat, Statistics, Numerics, Geometry, GeonextParser, Type, Transform) {

    "use strict";

    /**
     * Curves are the common object for function graphs, parametric curves, polar curves, and data plots.
     * @class Creates a new curve object. Do not use this constructor to create a curve. Use {@link JXG.Board#create} with
     * type {@link Curve}, or {@link Functiongraph} instead.
     * @augments JXG.GeometryElement
     * @param {String|JXG.Board} board The board the new curve is drawn on.
     * @param {Array} parents defining terms An array with the functon terms or the data points of the curve.
     * @param {Object} attributes Defines the visual appearance of the curve.
     * @see JXG.Board#generateName
     * @see JXG.Board#addCurve
     */
    JXG.Curve = function (board, parents, attributes) {
        this.constructor(board, attributes, Const.OBJECT_TYPE_CURVE, Const.OBJECT_CLASS_CURVE);

        this.points = [];
        /**
         * Number of points on curves. This value changes
         * between numberPointsLow and numberPointsHigh.
         * It is set in {@link JXG.Curve#updateCurve}.
         */
        this.numberPoints = this.visProp.numberpointshigh;

        this.bezierDegree = 1;

        this.dataX = null;
        this.dataY = null;

        if (Type.exists(parents[0])) {
            this.varname = parents[0];
        } else {
            this.varname = 'x';
        }

        // function graphs: "x"
        this.xterm = parents[1];
        // function graphs: e.g. "x^2"
        this.yterm = parents[2];

        // Converts GEONExT syntax into JavaScript syntax
        this.generateTerm(this.varname, this.xterm, this.yterm, parents[3], parents[4]);
        // First evaluation of the curve
        this.updateCurve();

        this.id = this.board.setId(this, 'G');
        this.board.renderer.drawCurve(this);

        this.board.finalizeAdding(this);

        this.createGradient();
        this.elType = 'curve';
        this.createLabel();

        if (typeof this.xterm === 'string') {
            this.notifyParents(this.xterm);
        }
        if (typeof this.yterm === 'string') {
            this.notifyParents(this.yterm);
        }

        this.methodMap = Type.deepCopy(this.methodMap, {
            generateTerm: 'generateTerm',
            setTerm: 'generateTerm'
        });
    };

    JXG.Curve.prototype = new GeometryElement();


    JXG.extend(JXG.Curve.prototype, /** @lends JXG.Curve.prototype */ {

        /**
         * Gives the default value of the left bound for the curve.
         * May be overwritten in {@link JXG.Curve#generateTerm}.
         * @returns {Number} Left bound for the curve.
         */
        minX: function () {
            var leftCoords;

            if (this.visProp.curvetype === 'polar') {
                return 0;
            }

            leftCoords = new Coords(Const.COORDS_BY_SCREEN, [0, 0], this.board, false);
            return leftCoords.usrCoords[1];
        },

        /**
         * Gives the default value of the right bound for the curve.
         * May be overwritten in {@link JXG.Curve#generateTerm}.
         * @returns {Number} Right bound for the curve.
         */
        maxX: function () {
            var rightCoords;

            if (this.visProp.curvetype === 'polar') {
                return 2 * Math.PI;
            }
            rightCoords = new Coords(Const.COORDS_BY_SCREEN, [this.board.canvasWidth, 0], this.board, false);

            return rightCoords.usrCoords[1];
        },

        /**
         * Treat the curve as curve with homogeneous coordinates.
         * @param {Number} t A number between 0.0 and 1.0.
         * @return {Number} Always 1.0
         */
        Z: function (t) {
            return 1;
        },

        /**
         * Checks whether (x,y) is near the curve.
         * @param {Number} x Coordinate in x direction, screen coordinates.
         * @param {Number} y Coordinate in y direction, screen coordinates.
         * @param {Number} start Optional start index for search on data plots.
         * @return {Boolean} True if (x,y) is near the curve, False otherwise.
         */
        hasPoint: function (x, y, start) {
            var t, checkPoint, len, invMat, c,
                i, tX, tY, res,
                steps = this.visProp.numberpointslow,
                d = (this.maxX() - this.minX()) / steps,
                prec = this.board.options.precision.hasPoint / this.board.unitX,
                dist = Infinity,
                suspendUpdate = true;

            checkPoint = new Coords(Const.COORDS_BY_SCREEN, [x, y], this.board, false);
            x = checkPoint.usrCoords[1];
            y = checkPoint.usrCoords[2];

            if (this.transformations.length > 0) {
                /**
                 * Transform the mouse/touch coordinates
                 * back to the original position of the curve.
                 */
                this.updateTransformMatrix();
                invMat = Mat.inverse(this.transformMat);
                c = Mat.matVecMult(invMat, [1, x, y]);
                x = c[1];
                y = c[2];
            }

            if (this.visProp.curvetype === 'parameter' ||
                    this.visProp.curvetype === 'polar' ||
                    this.visProp.curvetype === 'functiongraph') {

                prec = prec * prec;

                // Brute force search for a point on the curve close to the mouse pointer
                for (i = 0, t = this.minX(); i < steps; i++) {
                    tX = this.X(t, suspendUpdate);
                    tY = this.Y(t, suspendUpdate);

                    dist = (x - tX) * (x - tX) + (y - tY) * (y - tY);

                    if (dist < prec) {
                        return true;
                    }

                    t += d;
                }
            } else if (this.visProp.curvetype === 'plot') {
                if (!Type.exists(start) || start < 0) {
                    start = 0;
                }

                len = this.numberPoints;
                for (i = start; i < len - 1; i++) {

                    if (this.bezierDegree === 3) {
                        res = Geometry.projectCoordsToBeziersegment([1, x, y], this, i);
                        //i += 2;
                    } else {
                        res = Geometry.projectCoordsToSegment(
                            [1, x, y],
                            [1, this.X(i), this.Y(i)],
                            [1, this.X(i + 1), this.Y(i + 1)]
                        );
                    }

                    if (res[1] >= 0 && res[1] <= 1 &&
                            Geometry.distance([1, x, y], res[0], 3) <= prec) {
                        return true;
                    }
                }
                return false;
            }
            return (dist < prec);
        },

        /**
         * Allocate points in the Coords array this.points
         */
        allocatePoints: function () {
            var i, len;

            len = this.numberPoints;

            if (this.points.length < this.numberPoints) {
                for (i = this.points.length; i < len; i++) {
                    this.points[i] = new Coords(Const.COORDS_BY_USER, [0, 0], this.board, false);
                }
            }
        },

        /**
         * Computes for equidistant points on the x-axis the values of the function
         * @returns {JXG.Curve} Reference to the curve object.
         * @see JXG.Curve#updateCurve
         */
        update: function () {
            if (this.needsUpdate) {
                if (this.visProp.trace) {
                    this.cloneToBackground(true);
                }
                this.updateCurve();
            }

            return this;
        },

        /**
         * Updates the visual contents of the curve.
         * @returns {JXG.Curve} Reference to the curve object.
         */
        updateRenderer: function () {
            var wasReal;

            if (this.needsUpdate && this.visProp.visible) {
                wasReal = this.isReal;

                this.checkReal();

                if (this.isReal || wasReal) {
                    this.board.renderer.updateCurve(this);
                }

                if (this.isReal) {
                    if (wasReal !== this.isReal) {
                        this.board.renderer.show(this);
                        if (this.hasLabel && this.label.visProp.visible) {
                            this.board.renderer.show(this.label.content);
                        }
                    }
                } else {
                    if (wasReal !== this.isReal) {
                        this.board.renderer.hide(this);
                        if (this.hasLabel && this.label.visProp.visible) {
                            this.board.renderer.hide(this.label);
                        }
                    }
                }

                // Update the label if visible.
                if (this.hasLabel && Type.exists(this.label.visProp) && this.label.visProp.visible) {
                    this.label.update();
                    this.board.renderer.updateText(this.label);
                }
            }
            return this;
        },

        /**
         * For dynamic dataplots updateCurve can be used to compute new entries
         * for the arrays {@link JXG.Curve#dataX} and {@link JXG.Curve#dataY}. It
         * is used in {@link JXG.Curve#updateCurve}. Default is an empty method, can
         * be overwritten by the user.
         */
        updateDataArray: function () {
            // this used to return this, but we shouldn't rely on the user to implement it.
        },

        /**
         * Computes for equidistant points on the x-axis the values
         * of the function.
         * If the mousemove event triggers this update, we use only few
         * points. Otherwise, e.g. on mouseup, many points are used.
         * @see JXG.Curve#update
         * @returns {JXG.Curve} Reference to the curve object.
         */
        updateCurve: function () {
            var len, mi, ma, x, y, i,
                suspendUpdate = false;

            this.updateTransformMatrix();
            this.updateDataArray();
            mi = this.minX();
            ma = this.maxX();

            // Discrete data points
            // x-coordinates are in an array
            if (Type.exists(this.dataX)) {
                this.numberPoints = this.dataX.length;
                len = this.numberPoints;

                // It is possible, that the array length has increased.
                this.allocatePoints();

                for (i = 0; i < len; i++) {
                    x = i;

                    // y-coordinates are in an array
                    if (Type.exists(this.dataY)) {
                        y = i;
                        // The last parameter prevents rounding in usr2screen().
                        this.points[i].setCoordinates(Const.COORDS_BY_USER, [this.dataX[i], this.dataY[i]], false);
                    } else {
                        // discrete x data, continuous y data
                        y = this.X(x);
                        // The last parameter prevents rounding in usr2screen().
                        this.points[i].setCoordinates(Const.COORDS_BY_USER, [this.dataX[i], this.Y(y, suspendUpdate)], false);
                    }

                    this.updateTransform(this.points[i]);
                    suspendUpdate = true;
                }
            // continuous x data
            } else {
                if (this.visProp.doadvancedplot) {
                    this.updateParametricCurve(mi, ma, len);
                } else {
                    if (this.board.updateQuality === this.board.BOARD_QUALITY_HIGH) {
                        this.numberPoints = this.visProp.numberpointshigh;
                    } else {
                        this.numberPoints = this.visProp.numberpointslow;
                    }

                    // It is possible, that the array length has increased.
                    this.allocatePoints();
                    this.updateParametricCurveNaive(mi, ma, this.numberPoints);
                }
                len = this.numberPoints;

                for (i = 0; i < len; i++) {
                    this.updateTransform(this.points[i]);
                }
            }

            return this;
        },

        updateTransformMatrix: function () {
            var t, c, i,
                len = this.transformations.length;

            this.transformMat = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

            for (i = 0; i < len; i++) {
                t = this.transformations[i];
                t.update();
                this.transformMat = Mat.matMatMult(t.matrix, this.transformMat);
            }

            return this;
        },

        /**
         * Check if at least one point on the curve is finite and real.
         **/
        checkReal: function () {
            var b = false, i, p,
                len = this.numberPoints;

            for (i = 0; i < len; i++) {
                p = this.points[i].usrCoords;
                if (!isNaN(p[1]) && !isNaN(p[2]) && Math.abs(p[0]) > Mat.eps) {
                    b = true;
                    break;
                }
            }
            this.isReal = b;
        },

        /**
         * Updates the data points of a parametric curve. This version is used if {@link JXG.Curve#doadvancedplot} is <tt>false</tt>.
         * @param {Number} mi Left bound of curve
         * @param {Number} ma Right bound of curve
         * @param {Number} len Number of data points
         * @returns {JXG.Curve} Reference to the curve object.
         */
        updateParametricCurveNaive: function (mi, ma, len) {
            var i, t,
                suspendUpdate = false,
                stepSize = (ma - mi) / len;

            for (i = 0; i < len; i++) {
                t = mi + i * stepSize;
                // The last parameter prevents rounding in usr2screen().
                this.points[i].setCoordinates(Const.COORDS_BY_USER, [this.X(t, suspendUpdate), this.Y(t, suspendUpdate)], false);
                suspendUpdate = true;
            }
            return this;
        },

        /**
         * Updates the data points of a parametric curve. This version is used if {@link JXG.Curve#doadvancedplot} is <tt>true</tt>.
         * @param {Number} mi Left bound of curve
         * @param {Number} ma Right bound of curve
         * @returns {JXG.Curve} Reference to the curve object.
         */
        updateParametricCurve: function (mi, ma) {
            var i, t, t0, d,
                x, y, x0, y0, top, depth,
                MAX_DEPTH, MAX_XDIST, MAX_YDIST,
                suspendUpdate = false,
                po = new Coords(Const.COORDS_BY_USER, [0, 0], this.board, false),
                dyadicStack = [],
                depthStack = [],
                pointStack = [],
                divisors = [],
                distOK = false,
                j = 0,
                distFromLine = function (p1, p2, p0) {
                    var lbda, d,
                        x0 = p0[1] - p1[1],
                        y0 = p0[2] - p1[2],
                        x1 = p2[0] - p1[1],
                        y1 = p2[1] - p1[2],
                        den = x1 * x1 + y1 * y1;

                    if (den >= Mat.eps) {
                        lbda = (x0 * x1 + y0 * y1) / den;
                        if (lbda > 0) {
                            if (lbda <= 1) {
                                x0 -= lbda * x1;
                                y0 -= lbda * y1;
                            // lbda = 1.0;
                            } else {
                                x0 -= x1;
                                y0 -= y1;
                            }
                        }
                    }
                    d = x0 * x0 + y0 * y0;
                    return Math.sqrt(d);
                };

            if (this.board.updateQuality === this.board.BOARD_QUALITY_LOW) {
                MAX_DEPTH = 15;
                MAX_XDIST = 10;
                MAX_YDIST = 10;
            } else {
                MAX_DEPTH = 21;
                MAX_XDIST = 0.7;
                MAX_YDIST = 0.7;
            }

            divisors[0] = ma - mi;
            for (i = 1; i < MAX_DEPTH; i++) {
                divisors[i] = divisors[i - 1] * 0.5;
            }

            i = 1;
            dyadicStack[0] = 1;
            depthStack[0] = 0;

            t = mi;
            po.setCoordinates(Const.COORDS_BY_USER, [this.X(t, suspendUpdate), this.Y(t, suspendUpdate)], false);

            // Now, there was a first call to the functions defining the curve.
            // Defining elements like sliders have been evaluated.
            // Therefore, we can set suspendUpdate to false, so that these defining elements
            // need not be evaluated anymore for the rest of the plotting.
            suspendUpdate = true;
            x0 = po.scrCoords[1];
            y0 = po.scrCoords[2];
            t0 = t;

            t = ma;
            po.setCoordinates(Const.COORDS_BY_USER, [this.X(t, suspendUpdate), this.Y(t, suspendUpdate)], false);
            x = po.scrCoords[1];
            y = po.scrCoords[2];

            pointStack[0] = [x, y];

            top = 1;
            depth = 0;

            this.points = [];
            this.points[j++] = new Coords(Const.COORDS_BY_SCREEN, [x0, y0], this.board, false);

            do {
                distOK = this.isDistOK(x - x0, y - y0, MAX_XDIST, MAX_YDIST) || this.isSegmentOutside(x0, y0, x, y);
                while (depth < MAX_DEPTH && (!distOK || depth < 6) && (depth <= 7 || this.isSegmentDefined(x0, y0, x, y))) {
                    // We jump out of the loop if
                    // * depth>=MAX_DEPTH or
                    // * (depth>=6 and distOK) or
                    // * (depth>7 and segment is not defined)

                    dyadicStack[top] = i;
                    depthStack[top] = depth;
                    pointStack[top] = [x, y];
                    top += 1;

                    i = 2 * i - 1;
                    // Here, depth is increased and may reach MAX_DEPTH
                    depth++;
                    // In that case, t is undefined and we will see a jump in the curve.
                    t = mi + i * divisors[depth];

                    po.setCoordinates(Const.COORDS_BY_USER, [this.X(t, suspendUpdate), this.Y(t, suspendUpdate)], false, true);
                    x = po.scrCoords[1];
                    y = po.scrCoords[2];
                    distOK = this.isDistOK(x - x0, y - y0, MAX_XDIST, MAX_YDIST) || this.isSegmentOutside(x0, y0, x, y);
                }

                if (j > 1) {
                    d = distFromLine(this.points[j - 2].scrCoords, [x, y], this.points[j - 1].scrCoords);
                    if (d < 0.015) {
                        j -= 1;
                    }
                }

                this.points[j] = new Coords(Const.COORDS_BY_SCREEN, [x, y], this.board, false);
                j += 1;

                x0 = x;
                y0 = y;
                t0 = t;

                top -= 1;
                x = pointStack[top][0];
                y = pointStack[top][1];
                depth = depthStack[top] + 1;
                i = dyadicStack[top] * 2;

            } while (top > 0 && j < 500000);

            this.numberPoints = this.points.length;

            return this;
        },

        /**
         * Crude and cheap test if the segment defined by the two points <tt>(x0, y0)</tt> and <tt>(x1, y1)</tt> is
         * outside the viewport of the board. All parameters have to be given in screen coordinates.
         * @param {Number} x0
         * @param {Number} y0
         * @param {Number} x1
         * @param {Number} y1
         * @returns {Boolean} <tt>true</tt> if the given segment is outside the visible area.
         */
        isSegmentOutside: function (x0, y0, x1, y1) {
            return (y0 < 0 && y1 < 0) || (y0 > this.board.canvasHeight && y1 > this.board.canvasHeight) ||
                (x0 < 0 && x1 < 0) || (x0 > this.board.canvasWidth && x1 > this.board.canvasWidth);
        },

        /**
         * Compares the absolute value of <tt>dx</tt> with <tt>MAXX</tt> and the absolute value of <tt>dy</tt>
         * with <tt>MAXY</tt>.
         * @param {Number} dx
         * @param {Number} dy
         * @param {Number} MAXX
         * @param {Number} MAXY
         * @returns {Boolean} <tt>true</tt>, if <tt>|dx| &lt; MAXX</tt> and <tt>|dy| &lt; MAXY</tt>.
         */
        isDistOK: function (dx, dy, MAXX, MAXY) {
            return (Math.abs(dx) < MAXX && Math.abs(dy) < MAXY) && !isNaN(dx + dy);
        },

        isSegmentDefined: function (x0, y0, x1, y1) {
            return !(isNaN(x0 + y0) && isNaN(x1 + y1));
        },

        /**
         * Applies the transformations of the curve to the given point <tt>p</tt>.
         * Before using it, {@link JXG.Curve#updateTransformMatrix} has to be called.
         * @param {JXG.Point} p
         * @returns {JXG.Point} The given point.
         */
        updateTransform: function (p) {
            var c,
                len = this.transformations.length;

            if (len > 0) {
                c = Mat.matVecMult(this.transformMat, p.usrCoords);
                p.setPosition(Const.COORDS_BY_USER, [c[1], c[2]]);
            }

            return p;
        },

        /**
         * Add transformations to this curve.
         * @param {JXG.Transformation|Array} transform Either one {@link JXG.Transformation} or an array of {@link JXG.Transformation}s.
         * @returns {JXG.Curve} Reference to the curve object.
         */
        addTransform: function (transform) {
            var i,
                list = Type.isArray(transform) ? transform : [transform],
                len = list.length;

            for (i = 0; i < len; i++) {
                this.transformations.push(list[i]);
            }

            return this;
        },

        /**
         * Translates the object by <tt>(x, y)</tt>.
         * @param {Number} method The type of coordinates used here. Possible values are {@link JXG.COORDS_BY_USER} and {@link JXG.COORDS_BY_SCREEN}.
         * @param {Array} coords array of translation vector.
         * @returns {JXG.Curve} Reference to the curve object.
         */
        setPosition: function (method, coords) {
            var t, obj, i,
                len = 0;

            if (Type.exists(this.parents)) {
                len = this.parents.length;
            }

            for (i = 0; i < len; i++) {
                obj = this.board.select(this.parents[i]);

                if (!obj.draggable()) {
                    return this;
                }
            }

            // We distinguish two cases:
            // 1) curves which depend on free elements, i.e. arcs and sectors
            // 2) other curves
            //
            // In the first case we simply transform the parents elements
            // In the second case we add a transform to the curve.
            //
            coords = new Coords(method, coords, this.board, false);
            t = this.board.create('transform', coords.usrCoords.slice(1), {type: 'translate'});

            if (len > 0) {
                for (i = 0; i < len; i++) {
                    obj = this.board.select(this.parents[i]);
                    t.applyOnce(obj);
                }
            } else {
                if (this.transformations.length > 0 &&
                        this.transformations[this.transformations.length - 1].isNumericMatrix) {
                    this.transformations[this.transformations.length - 1].melt(t);
                } else {
                    this.addTransform(t);
                }
            }
            return this;
        },

        /**
         * Moves the cuvre by the difference of two coordinates.
         * @param {Number} method The type of coordinates used here. Possible values are {@link JXG.COORDS_BY_USER} and {@link JXG.COORDS_BY_SCREEN}.
         * @param {Array} coords coordinates in screen/user units
         * @param {Array} oldcoords previous coordinates in screen/user units
         * @returns {JXG.Curve} this element
         */
        setPositionDirectly: function (method, coords, oldcoords) {
            var c = new Coords(method, coords, this.board, false),
                oldc = new Coords(method, oldcoords, this.board, false),
                dc = Statistics.subtract(c.usrCoords, oldc.usrCoords);

            this.setPosition(Const.COORDS_BY_USER, dc);

            return this;
        },

        /**
         * Generate the method curve.X() in case curve.dataX is an array
         * and generate the method curve.Y() in case curve.dataY is an array.
         * @private
         * @param {String} which Either 'X' or 'Y'
         * @returns {function}
         **/
        interpolationFunctionFromArray: function (which) {
            var data = 'data' + which;

            return function (t, suspendedUpdate) {
                var i, j, f1, f2, z, t0, t1,
                    arr = this[data],
                    len = arr.length,
                    f = [];

                if (isNaN(t)) {
                    return NaN;
                }

                if (t < 0) {
                    if (Type.isFunction(arr[0])) {
                        return arr[0]();
                    }

                    return arr[0];
                }

                if (this.bezierDegree === 3) {
                    len /= 3;
                    if (t >= len) {
                        if (Type.isFunction(arr[arr.length - 1])) {
                            return arr[arr.length - 1]();
                        }

                        return arr[arr.length - 1];
                    }

                    i = Math.floor(t) * 3;
                    t0 = t % 1;
                    t1 = 1 - t0;

                    for (j = 0; j < 4; j++) {
                        if (Type.isFunction(arr[i + j])) {
                            f[j] = arr[i + j]();
                        } else {
                            f[j] = arr[i + j];
                        }
                    }

                    return t1 * t1 * (t1 * f[0] + 3 * t0 * f[1]) + (3 * t1 * f[2] + t0 * f[3]) * t0 * t0;
                }

                if (t > len - 2) {
                    i = len - 2;
                } else {
                    i = parseInt(Math.floor(t), 10);
                }

                if (i === t) {
                    if (Type.isFunction(arr[i])) {
                        return arr[i]();
                    }
                    return arr[i];
                }

                for (j = 0; j < 2; j++) {
                    if (Type.isFunction(arr[i + j])) {
                        f[j] = arr[i + j]();
                    } else {
                        f[j] = arr[i + j];
                    }
                }
                return f[0] + (f[1] - f[0]) * (t - i);
            };
        },
        /**
         * Converts the GEONExT syntax of the defining function term into JavaScript.
         * New methods X() and Y() for the Curve object are generated, further
         * new methods for minX() and maxX().
         * @see JXG.GeonextParser.geonext2JS.
         */
        generateTerm: function (varname, xterm, yterm, mi, ma) {
            var fx, fy;

            // Generate the methods X() and Y()
            if (Type.isArray(xterm)) {
                // Discrete data
                this.dataX = xterm;

                this.numberPoints = this.dataX.length;
                this.X = this.interpolationFunctionFromArray('X');
                this.visProp.curvetype = 'plot';
                this.isDraggable = true;
            } else {
                // Continuous data
                this.X = Type.createFunction(xterm, this.board, varname);
                if (Type.isString(xterm)) {
                    this.visProp.curvetype = 'functiongraph';
                } else if (Type.isFunction(xterm) || Type.isNumber(xterm)) {
                    this.visProp.curvetype = 'parameter';
                }

                this.isDraggable = true;
            }

            if (Type.isArray(yterm)) {
                this.dataY = yterm;
                this.Y = this.interpolationFunctionFromArray('Y');
            } else {
                this.Y = Type.createFunction(yterm, this.board, varname);
            }

            /**
             * Polar form
             * Input data is function xterm() and offset coordinates yterm
             */
            if (Type.isFunction(xterm) && Type.isArray(yterm)) {
                // Xoffset, Yoffset
                fx = Type.createFunction(yterm[0], this.board, '');
                fy = Type.createFunction(yterm[1], this.board, '');

                this.X = function (phi) {
                    return xterm(phi) * Math.cos(phi) + fx();
                };

                this.Y = function (phi) {
                    return xterm(phi) * Math.sin(phi) + fy();
                };

                this.visProp.curvetype = 'polar';
            }

            // Set the bounds lower bound
            if (Type.exists(mi)) {
                this.minX = Type.createFunction(mi, this.board, '');
            }
            if (Type.exists(ma)) {
                this.maxX = Type.createFunction(ma, this.board, '');
            }
        },

        /**
         * Finds dependencies in a given term and notifies the parents by adding the
         * dependent object to the found objects child elements.
         * @param {String} contentStr String containing dependencies for the given object.
         */
        notifyParents: function (contentStr) {
            GeonextParser.findDependencies(this, contentStr, this.board);
        },

        // documented in geometry element
        getLabelAnchor: function () {
            var c, x, y,
                ax = 0.05 * this.board.canvasWidth,
                ay = 0.05 * this.board.canvasHeight,
                bx = 0.95 * this.board.canvasWidth,
                by = 0.95 * this.board.canvasHeight;

            switch (this.visProp.label.position) {
            case 'ulft':
                x = ax;
                y = ay;
                break;
            case 'llft':
                x = ax;
                y = by;
                break;
            case 'rt':
                x = bx;
                y = 0.5 * by;
                break;
            case 'lrt':
                x = bx;
                y = by;
                break;
            case 'urt':
                x = bx;
                y = ay;
                break;
            case 'top':
                x = 0.5 * bx;
                y = ay;
                break;
            case 'bot':
                x = 0.5 * bx;
                y = by;
                break;
            default:
                // includes case 'lft'
                x = ax;
                y = 0.5 * by;
            }

            c = new Coords(Const.COORDS_BY_SCREEN, [x, y], this.board, false);
            return Geometry.projectCoordsToCurve(c.usrCoords[1], c.usrCoords[2], 0, this, this.board)[0];
        },

        // documented in geometry element
        cloneToBackground: function () {
            var er,
                copy = {
                    id: this.id + 'T' + this.numTraces,
                    elementClass: Const.OBJECT_CLASS_CURVE,

                    points: this.points.slice(0),
                    bezierDegree: this.bezierDegree,
                    numberPoints: this.numberPoints,
                    board: this.board,
                    visProp: Type.deepCopy(this.visProp, this.visProp.traceattributes, true)
                };

            copy.visProp.layer = this.board.options.layer.trace;
            copy.visProp.curvetype = this.visProp.curvetype;
            this.numTraces++;

            Type.clearVisPropOld(copy);

            er = this.board.renderer.enhancedRendering;
            this.board.renderer.enhancedRendering = true;
            this.board.renderer.drawCurve(copy);
            this.board.renderer.enhancedRendering = er;
            this.traces[copy.id] = copy.rendNode;

            return this;
        },

        // already documented in GeometryElement
        bounds: function () {
            var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity,
                l = this.points.length, i;

            for (i = 0; i < l; i++) {
                if (minX > this.points[i].usrCoords[1]) {
                    minX = this.points[i].usrCoords[1];
                }

                if (maxX < this.points[i].usrCoords[1]) {
                    maxX = this.points[i].usrCoords[1];
                }

                if (minY > this.points[i].usrCoords[2]) {
                    minY = this.points[i].usrCoords[2];
                }

                if (maxY < this.points[i].usrCoords[2]) {
                    maxY = this.points[i].usrCoords[2];
                }
            }

            return [minX, maxY, maxX, minY];
        }
    });


    /**
     * @class This element is used to provide a constructor for curve, which is just a wrapper for element {@link Curve}.
     * A curve is a mapping from R to R^2. t mapsto (x(t),y(t)). The graph is drawn for t in the interval [a,b].
     * <p>
     * The following types of curves can be plotted:
     * <ul>
     *  <li> parametric curves: t mapsto (x(t),y(t)), where x() and y() are univariate functions.
     *  <li> polar curves: curves commonly written with polar equations like spirals and cardioids.
     *  <li> data plots: plot linbe segments through a given list of coordinates.
     * </ul>
     * @pseudo
     * @description
     * @name Curve
     * @augments JXG.Curve
     * @constructor
     * @type JXG.Curve
     *
     * @param {function,number_function,number_function,number_function,number} x,y,a_,b_ Parent elements for Parametric Curves.
     *                     <p>
     *                     x describes the x-coordinate of the curve. It may be a function term in one variable, e.g. x(t).
     *                     In case of x being of type number, x(t) is set to  a constant function.
     *                     this function at the values of the array.
     *                     </p>
     *                     <p>
     *                     y describes the y-coordinate of the curve. In case of a number, y(t) is set to the constant function
     *                     returning this number.
     *                     </p>
     *                     <p>
     *                     Further parameters are an optional number or function for the left interval border a,
     *                     and an optional number or function for the right interval border b.
     *                     </p>
     *                     <p>
     *                     Default values are a=-10 and b=10.
     *                     </p>
     * @param {array_array,function,number} x,y Parent elements for Data Plots.
     *                     <p>
     *                     x and y are arrays contining the x and y coordinates of the data points which are connected by
     *                     line segments. The individual entries of x and y may also be functions.
     *                     In case of x being an array the curve type is data plot, regardless of the second parameter and
     *                     if additionally the second parameter y is a function term the data plot evaluates.
     *                     </p>
     * @param {function_array,function,number_function,number_function,number} r,offset_,a_,b_ Parent elements for Polar Curves.
     *                     <p>
     *                     The first parameter is a function term r(phi) describing the polar curve.
     *                     </p>
     *                     <p>
     *                     The second parameter is the offset of the curve. It has to be
     *                     an array containing numbers or functions describing the offset. Default value is the origin [0,0].
     *                     </p>
     *                     <p>
     *                     Further parameters are an optional number or function for the left interval border a,
     *                     and an optional number or function for the right interval border b.
     *                     </p>
     *                     <p>
     *                     Default values are a=-10 and b=10.
     *                     </p>
     * @see JXG.Curve
     * @example
     * // Parametric curve
     * // Create a curve of the form (t-sin(t), 1-cos(t), i.e.
     * // the cycloid curve.
     *   var graph = board.create('curve',
     *                        [function(t){ return t-Math.sin(t);},
     *                         function(t){ return 1-Math.cos(t);},
     *                         0, 2*Math.PI]
     *                     );
     * </pre><div id="af9f818b-f3b6-4c4d-8c4c-e4a4078b726d" style="width: 300px; height: 300px;"></div>
     * <script type="text/javascript">
     *   var c1_board = JXG.JSXGraph.initBoard('af9f818b-f3b6-4c4d-8c4c-e4a4078b726d', {boundingbox: [-1, 5, 7, -1], axis: true, showcopyright: false, shownavigation: false});
     *   var graph1 = c1_board.create('curve', [function(t){ return t-Math.sin(t);},function(t){ return 1-Math.cos(t);},0, 2*Math.PI]);
     * </script><pre>
     * @example
     * // Data plots
     * // Connect a set of points given by coordinates with dashed line segments.
     * // The x- and y-coordinates of the points are given in two separate
     * // arrays.
     *   var x = [0,1,2,3,4,5,6,7,8,9];
     *   var y = [9.2,1.3,7.2,-1.2,4.0,5.3,0.2,6.5,1.1,0.0];
     *   var graph = board.create('curve', [x,y], {dash:2});
     * </pre><div id="7dcbb00e-b6ff-481d-b4a8-887f5d8c6a83" style="width: 300px; height: 300px;"></div>
     * <script type="text/javascript">
     *   var c3_board = JXG.JSXGraph.initBoard('7dcbb00e-b6ff-481d-b4a8-887f5d8c6a83', {boundingbox: [-1,10,10,-1], axis: true, showcopyright: false, shownavigation: false});
     *   var x = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
     *   var y = [9.2, 1.3, 7.2, -1.2, 4.0, 5.3, 0.2, 6.5, 1.1, 0.0];
     *   var graph3 = c3_board.create('curve', [x,y], {dash:2});
     * </script><pre>
     * @example
     * // Polar plot
     * // Create a curve with the equation r(phi)= a*(1+phi), i.e.
     * // a cardioid.
     *   var a = board.create('slider',[[0,2],[2,2],[0,1,2]]);
     *   var graph = board.create('curve',
     *                        [function(phi){ return a.Value()*(1-Math.cos(phi));},
     *                         [1,0],
     *                         0, 2*Math.PI]
     *                     );
     * </pre><div id="d0bc7a2a-8124-45ca-a6e7-142321a8f8c2" style="width: 300px; height: 300px;"></div>
     * <script type="text/javascript">
     *   var c2_board = JXG.JSXGraph.initBoard('d0bc7a2a-8124-45ca-a6e7-142321a8f8c2', {boundingbox: [-3,3,3,-3], axis: true, showcopyright: false, shownavigation: false});
     *   var a = c2_board.create('slider',[[0,2],[2,2],[0,1,2]]);
     *   var graph2 = c2_board.create('curve', [function(phi){ return a.Value()*(1-Math.cos(phi));}, [1,0], 0, 2*Math.PI]);
     * </script><pre>
     */
    JXG.createCurve = function (board, parents, attributes) {
        var attr = Type.copyAttributes(attributes, board.options, 'curve');
        return new JXG.Curve(board, ['x'].concat(parents), attr);
    };

    JXG.registerElement('curve', JXG.createCurve);

    /**
     * @class This element is used to provide a constructor for functiongraph, which is just a wrapper for element {@link Curve} with {@link JXG.Curve#X()}
     * set to x. The graph is drawn for x in the interval [a,b].
     * @pseudo
     * @description
     * @name Functiongraph
     * @augments JXG.Curve
     * @constructor
     * @type JXG.Curve
     * @param {function_number,function_number,function} f,a_,b_ Parent elements are a function term f(x) describing the function graph.
     *         <p>
     *         Further, an optional number or function for the left interval border a,
     *         and an optional number or function for the right interval border b.
     *         <p>
     *         Default values are a=-10 and b=10.
     * @see JXG.Curve
     * @example
     * // Create a function graph for f(x) = 0.5*x*x-2*x
     *   var graph = board.create('functiongraph',
     *                        [function(x){ return 0.5*x*x-2*x;}, -2, 4]
     *                     );
     * </pre><div id="efd432b5-23a3-4846-ac5b-b471e668b437" style="width: 300px; height: 300px;"></div>
     * <script type="text/javascript">
     *   var alex1_board = JXG.JSXGraph.initBoard('efd432b5-23a3-4846-ac5b-b471e668b437', {boundingbox: [-3, 7, 5, -3], axis: true, showcopyright: false, shownavigation: false});
     *   var graph = alex1_board.create('functiongraph', [function(x){ return 0.5*x*x-2*x;}, -2, 4]);
     * </script><pre>
     * @example
     * // Create a function graph for f(x) = 0.5*x*x-2*x with variable interval
     *   var s = board.create('slider',[[0,4],[3,4],[-2,4,5]]);
     *   var graph = board.create('functiongraph',
     *                        [function(x){ return 0.5*x*x-2*x;},
     *                         -2,
     *                         function(){return s.Value();}]
     *                     );
     * </pre><div id="4a203a84-bde5-4371-ad56-44619690bb50" style="width: 300px; height: 300px;"></div>
     * <script type="text/javascript">
     *   var alex2_board = JXG.JSXGraph.initBoard('4a203a84-bde5-4371-ad56-44619690bb50', {boundingbox: [-3, 7, 5, -3], axis: true, showcopyright: false, shownavigation: false});
     *   var s = alex2_board.create('slider',[[0,4],[3,4],[-2,4,5]]);
     *   var graph = alex2_board.create('functiongraph', [function(x){ return 0.5*x*x-2*x;}, -2, function(){return s.Value();}]);
     * </script><pre>
     */
    JXG.createFunctiongraph = function (board, parents, attributes) {
        var attr,
            par = ['x', 'x'].concat(parents);

        attr = Type.copyAttributes(attributes, board.options, 'curve');
        attr.curvetype = 'functiongraph';
        return new JXG.Curve(board, par, attr);
    };

    JXG.registerElement('functiongraph', JXG.createFunctiongraph);
    JXG.registerElement('plot', JXG.createFunctiongraph);


    /**
     * TODO
     * Create a dynamic spline interpolated curve given by sample points p_1 to p_n.
     * @param {JXG.Board} board Reference to the board the spline is drawn on.
     * @param {Array} parents Array of points the spline interpolates
     * @param {Object} attributes Define color, width, ... of the spline
     * @returns {JXG.Curve} Returns reference to an object of type JXG.Curve.
     */
    JXG.createSpline = function (board, parents, attributes) {
        var f;

        f = function () {
            var D, x = [], y = [];

            return function (t, suspended) {
                var i, j;

                if (!suspended) {
                    x = [];
                    y = [];

                    // given as [x[], y[]]
                    if (parents.length === 2 && Type.isArray(parents[0]) && Type.isArray(parents[1]) && parents[0].length === parents[1].length) {
                        for (i = 0; i < parents[0].length; i++) {
                            if (typeof parents[0][i] === 'function') {
                                x.push(parents[0][i]());
                            } else {
                                x.push(parents[0][i]);
                            }

                            if (typeof parents[1][i] === 'function') {
                                y.push(parents[1][i]());
                            } else {
                                y.push(parents[1][i]);
                            }
                        }
                    } else {
                        for (i = 0; i < parents.length; i++) {
                            if (Type.isPoint(parents[i])) {
                                x.push(parents[i].X());
                                y.push(parents[i].Y());
                            // given as [[x1,y1], [x2, y2], ...]
                            } else if (Type.isArray(parents[i]) && parents[i].length === 2) {
                                for (i = 0; i < parents.length; i++) {
                                    if (typeof parents[i][0] === 'function') {
                                        x.push(parents[i][0]());
                                    } else {
                                        x.push(parents[i][0]);
                                    }

                                    if (typeof parents[i][1] === 'function') {
                                        y.push(parents[i][1]());
                                    } else {
                                        y.push(parents[i][1]);
                                    }
                                }
                            }
                        }
                    }

                    // The array D has only to be calculated when the position of one or more sample point
                    // changes. otherwise D is always the same for all points on the spline.
                    D = Numerics.splineDef(x, y);
                }
                return Numerics.splineEval(t, x, y, D);
            };
        };
        return board.create('curve', ["x", f()], attributes);
    };

    /**
     * Register the element type spline at JSXGraph
     * @private
     */
    JXG.registerElement('spline', JXG.createSpline);

    /**
     * @class This element is used to provide a constructor for Riemann sums, which is realized as a special curve.
     * The returned element has the method Value() which returns the sum of the areas of the rectangles.
     * @pseudo
     * @description
     * @name Riemannsum
     * @augments JXG.Curve
     * @constructor
     * @type JXG.Curve
     * @param {function_number,function_string,function_function,number_function,number} f,n,type_,a_,b_ Parent elements of Riemannsum are a
     *         function term f(x) describing the function graph which is filled by the Riemann rectangles.
     *         <p>
     *         n determines the number of rectangles, it is either a fixed number or a function.
     *         <p>
     *         type is a string or function returning one of the values:  'left', 'right', 'middle', 'lower', 'upper', 'random', 'simpson', or 'trapezodial'.
     *         Default value is 'left'.
     *         <p>
     *         Further parameters are an optional number or function for the left interval border a,
     *         and an optional number or function for the right interval border b.
     *         <p>
     *         Default values are a=-10 and b=10.
     * @see JXG.Curve
     * @example
     * // Create Riemann sums for f(x) = 0.5*x*x-2*x.
     *   var s = board.create('slider',[[0,4],[3,4],[0,4,10]],{snapWidth:1});
     *   var f = function(x) { return 0.5*x*x-2*x; };
     *   var r = board.create('riemannsum',
     *               [f, function(){return s.Value();}, 'upper', -2, 5],
     *               {fillOpacity:0.4}
     *               );
     *   var g = board.create('functiongraph',[f, -2, 5]);
     *   var t = board.create('text',[-1,-1, function(){ return 'Sum=' + r.Value().toFixed(4); }]);
     * </pre><div id="940f40cc-2015-420d-9191-c5d83de988cf" style="width: 300px; height: 300px;"></div>
     * <script type="text/javascript">
     *   var rs1_board = JXG.JSXGraph.initBoard('940f40cc-2015-420d-9191-c5d83de988cf', {boundingbox: [-3, 7, 5, -3], axis: true, showcopyright: false, shownavigation: false});
     *   var f = function(x) { return 0.5*x*x-2*x; };
     *   var s = rs1_board.create('slider',[[0,4],[3,4],[0,4,10]],{snapWidth:1});
     *   var r = rs1_board.create('riemannsum', [f, function(){return s.Value();}, 'upper', -2, 5], {fillOpacity:0.4});
     *   var g = rs1_board.create('functiongraph', [f, -2, 5]);
     *   var t = board.create('text',[-1,-1, function(){ return 'Sum=' + r.Value().toFixed(4); }]);
     * </script><pre>
     */
    JXG.createRiemannsum = function (board, parents, attributes) {
        var n, type, f, par, c, attr;

        attr = Type.copyAttributes(attributes, board.options, 'riemannsum');
        attr.curvetype = 'plot';

        f = parents[0];
        n = Type.createFunction(parents[1], board, '');

        if (!Type.exists(n)) {
            throw new Error("JSXGraph: JXG.createRiemannsum: argument '2' n has to be number or function." +
                "\nPossible parent types: [function,n:number|function,type,start:number|function,end:number|function]");
        }

        type = Type.createFunction(parents[2], board, '', false);
        if (!Type.exists(type)) {
            throw new Error("JSXGraph: JXG.createRiemannsum: argument 3 'type' has to be string or function." +
                "\nPossible parent types: [function,n:number|function,type,start:number|function,end:number|function]");
        }

        par = [[0], [0]].concat(parents.slice(3));

        c = board.create('curve', par, attr);

        c.sum = 0.0;
        c.Value = function () {
            return this.sum;
        };

        c.updateDataArray = function () {
            var u = Numerics.riemann(f, n(), type(), this.minX(), this.maxX());
            this.dataX = u[0];
            this.dataY = u[1];

            // Update "Riemann sum"
            this.sum = u[2];
        };

        return c;
    };

    JXG.registerElement('riemannsum', JXG.createRiemannsum);

    /**
     * @class This element is used to provide a constructor for travce curve (simple locus curve), which is realized as a special curve.
     * @pseudo
     * @description
     * @name Tracecurve
     * @augments JXG.Curve
     * @constructor
     * @type JXG.Curve
     * @param {Point,Point} Parent elements of Tracecurve are a
     *         glider point and a point whose locus is traced.
     * @see JXG.Curve
     * @example
     * // Create trace curve.
     var c1 = board.create('circle',[[0, 0], [2, 0]]),
     p1 = board.create('point',[-3, 1]),
     g1 = board.create('glider',[2, 1, c1]),
     s1 = board.create('segment',[g1, p1]),
     p2 = board.create('midpoint',[s1]),
     curve = board.create('tracecurve', [g1, p2]);

     * </pre><div id="5749fb7d-04fc-44d2-973e-45c1951e29ad" style="width: 300px; height: 300px;"></div>
     * <script type="text/javascript">
     *   var tc1_board = JXG.JSXGraph.initBoard('5749fb7d-04fc-44d2-973e-45c1951e29ad', {boundingbox: [-4, 4, 4, -4], axis: false, showcopyright: false, shownavigation: false});
     *   var c1 = tc1_board.create('circle',[[0, 0], [2, 0]]),
     *       p1 = tc1_board.create('point',[-3, 1]),
     *       g1 = tc1_board.create('glider',[2, 1, c1]),
     *       s1 = tc1_board.create('segment',[g1, p1]),
     *       p2 = tc1_board.create('midpoint',[s1]),
     *       curve = tc1_board.create('tracecurve', [g1, p2]);
     * </script><pre>
     */
    JXG.createTracecurve = function (board, parents, attributes) {
        var c, glider, tracepoint, attr;

        if (parents.length !== 2) {
            throw new Error("JSXGraph: Can't create trace curve with given parent'" +
                "\nPossible parent types: [glider, point]");
        }

        glider = board.select(parents[0]);
        tracepoint = board.select(parents[1]);

        if (glider.type !== Const.OBJECT_TYPE_GLIDER || !Type.isPoint(tracepoint)) {
            throw new Error("JSXGraph: Can't create trace curve with parent types '" +
                (typeof parents[0]) + "' and '" + (typeof parents[1]) + "'." +
                "\nPossible parent types: [glider, point]");
        }

        attr = Type.copyAttributes(attributes, board.options, 'tracecurve');
        attr.curvetype = 'plot';
        c = board.create('curve', [[0], [0]], attr);

        c.updateDataArray = function () {
            var i, step, t, el, pEl, x, y, v, from, savetrace,
                le = attr.numberpoints,
                savePos = glider.position,
                slideObj = glider.slideObject,
                mi = slideObj.minX(),
                ma = slideObj.maxX();

            // set step width
            step = (ma - mi) / le;
            this.dataX = [];
            this.dataY = [];

            /*
             * For gliders on circles and lines a closed curve is computed.
             * For gliders on curves the curve is not closed.
             */
            if (slideObj.elementClass !== Const.OBJECT_CLASS_CURVE) {
                le++;
            }

            // Loop over all steps
            for (i = 0; i < le; i++) {
                t = mi + i * step;
                x = slideObj.X(t) / slideObj.Z(t);
                y = slideObj.Y(t) / slideObj.Z(t);

                // Position the glider
                glider.setPositionDirectly(Const.COORDS_BY_USER, [x, y]);
                from = false;

                // Update all elements from the glider up to the trace element
                for (el in this.board.objects) {
                    if (this.board.objects.hasOwnProperty(el)) {
                        pEl = this.board.objects[el];

                        if (pEl === glider) {
                            from = true;
                        }

                        if (from && pEl.needsRegularUpdate) {
                            // Save the trace mode of the element
                            savetrace = pEl.visProp.trace;
                            pEl.visProp.trace = false;
                            pEl.needsUpdate = true;
                            pEl.update(true);

                            // Restore the trace mode
                            pEl.visProp.trace = savetrace;
                            if (pEl === tracepoint) {
                                break;
                            }
                        }
                    }
                }

                // Store the position of the trace point
                this.dataX[i] = tracepoint.X();
                this.dataY[i] = tracepoint.Y();
            }

            // Restore the original position of the glider
            glider.position = savePos;
            from = false;

            // Update all elements from the glider to the trace point
            for (el in this.board.objects) {
                if (this.board.objects.hasOwnProperty(el)) {
                    pEl = this.board.objects[el];
                    if (pEl === glider) {
                        from = true;
                    }

                    if (from && pEl.needsRegularUpdate) {
                        savetrace = pEl.visProp.trace;
                        pEl.visProp.trace = false;
                        pEl.needsUpdate = true;
                        pEl.update(true);
                        pEl.visProp.trace = savetrace;

                        if (pEl === tracepoint) {
                            break;
                        }
                    }
                }
            }
        };

        return c;
    };

    JXG.registerElement('tracecurve', JXG.createTracecurve);

    return {
        Curve: JXG.Curve,
        createCurve: JXG.createCurve,
        createFunctiongraph: JXG.createFunctiongraph,
        createPlot: JXG.createPlot,
        createSpline: JXG.createSpline,
        createRiemannsum: JXG.createRiemannsum,
        createTracecurve: JXG.createTracecurve
    };
});
