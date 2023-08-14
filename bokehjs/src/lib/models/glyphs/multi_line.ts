import type {SpatialIndex} from "core/util/spatial"
import {inplace} from "core/util/projections"
import type {PointGeometry, SpanGeometry, RectGeometry} from "core/geometry"
import {LineVector} from "core/property_mixins"
import type * as visuals from "core/visuals"
import type {Rect, RaggedArray, FloatArray, ScreenArray} from "core/types"
import * as hittest from "core/hittest"
import * as p from "core/properties"
import {minmax2} from "core/util/arrayable"
import {to_object} from "core/util/object"
import type {Context2d} from "core/util/canvas"
import type {GlyphData} from "./glyph"
import {Glyph, GlyphView} from "./glyph"
import {generic_line_vector_legend, line_interpolation} from "./utils"
import {Selection} from "../selections/selection"

export type MultiLineData = GlyphData & p.UniformsOf<MultiLine.Mixins> & {
  _xs: RaggedArray<FloatArray>
  _ys: RaggedArray<FloatArray>

  sxs: RaggedArray<ScreenArray>
  sys: RaggedArray<ScreenArray>
}

export interface MultiLineView extends MultiLineData {}

export class MultiLineView extends GlyphView {
  declare model: MultiLine
  declare visuals: MultiLine.Visuals

  protected override _project_data(): void {
    inplace.project_xy(this._xs.array, this._ys.array)
  }

  protected _index_data(index: SpatialIndex): void {
    const {data_size} = this

    for (let i = 0; i < data_size; i++) {
      const xsi = this._xs.get(i)
      const ysi = this._ys.get(i)

      const [x0, x1, y0, y1] = minmax2(xsi, ysi)
      index.add_rect(x0, y0, x1, y1)
    }
  }

  protected _render(ctx: Context2d, indices: number[], data?: MultiLineData): void {
    const {sxs, sys} = data ?? this

    for (const i of indices) {
      const sx = sxs.get(i)
      const sy = sys.get(i)

      const n = Math.min(sx.length, sy.length)

      let move = true
      ctx.beginPath()

      for (let j = 0; j < n; j++) {
        const sx_j = sx[j]
        const sy_j = sy[j]

        if (!isFinite(sx_j + sy_j))
          move = true
        else {
          if (move) {
            ctx.moveTo(sx_j, sy_j)
            move = false
          } else
            ctx.lineTo(sx_j, sy_j)
        }
      }

      this.visuals.line.set_vectorize(ctx, i)
      ctx.stroke()
    }
  }

  protected override _hit_point(geometry: PointGeometry): Selection {
    const point = {x: geometry.sx, y: geometry.sy}
    let shortest = 9999

    const hits: Map<number, number[]> = new Map()
    for (let i = 0, end = this.sxs.length; i < end; i++) {
      const threshold = Math.max(2, this.line_width.get(i)/2)

      const sxsi = this.sxs.get(i)
      const sysi = this.sys.get(i)

      let points: number[] | null = null
      for (let j = 0, endj = sxsi.length - 1; j < endj; j++) {
        const p0 = {x: sxsi[j],   y: sysi[j]}
        const p1 = {x: sxsi[j+1], y: sysi[j+1]}
        const dist = hittest.dist_to_segment(point, p0, p1)
        if (dist < threshold && dist < shortest) {
          shortest = dist
          points = [j]
        }
      }
      if (points != null) {
        hits.set(i, points)
      }
    }

    return new Selection({
      indices: [...hits.keys()],
      multiline_indices: to_object(hits), // TODO: remove to_object()
    })
  }

  protected override _hit_rect(geometry: RectGeometry): Selection {
    const {sx0, sx1, sy0, sy1} = geometry
    
    console.log(sx0, sx1, sy0, sy1)

    const hits: Map<number, number[]> = new Map()
    for (let i = 0, end = this.sxs.length; i < end; i++) {
      const sxsi = this.sxs.get(i)
      const sysi = this.sys.get(i)

      let points: number[] | null = null
      for (let j = 0, endj = sxsi.length - 1; j < endj; j++) {
        const p0 = {x: sxsi[j],   y: sysi[j]}
        const p1 = {x: sxsi[j+1], y: sysi[j+1]}
        // check if any point along line of p0 and p1 is in rect
        if (this.lineRect(p0.x, p0.y, p1.x, p1.y, sx0, sy0, sx1, sy1))
          points = [j]
      }
      if (points != null) {
        hits.set(i, points)
      }
    }

    return new Selection({
      indices: [...hits.keys()],
      multiline_indices: to_object(hits), // TODO: remove to_object()
    })
  }

  lineRect(x1: number, y1: number, x2: number, y2: number, rx1: number, ry1: number, rx2: number, ry2: number): boolean {
    // check if the line has hit any of the rectangle's sides
    // uses the Line/Line function below
    const left: boolean   = this.lineLine(x1,y1,x2,y2, rx1,ry1,rx1,ry2)
    const right: boolean  = this.lineLine(x1,y1,x2,y2, rx2,ry1,rx2,ry2)
    const top: boolean    = this.lineLine(x1,y1,x2,y2, rx1,ry1,rx2,ry1)
    const bottom: boolean = this.lineLine(x1,y1,x2,y2, rx1,ry2,rx2,ry2)
  
    // if ANY of the above are true, the line
    // has hit the rectangle
    if (left || right || top || bottom) {
      return true;
    }
    return false;
  }

  lineLine(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number): boolean {
    // calculate the direction of the lines
    const uA: number = ((x4-x3)*(y1-y3) - (y4-y3)*(x1-x3)) / ((y4-y3)*(x2-x1) - (x4-x3)*(y2-y1));
    const uB: number = ((x2-x1)*(y1-y3) - (y2-y1)*(x1-x3)) / ((y4-y3)*(x2-x1) - (x4-x3)*(y2-y1));

    // if uA and uB are between 0-1, lines are colliding
    if (uA >= 0 && uA <= 1 && uB >= 0 && uB <= 1)
      return true
    return false
  }

  protected override _hit_span(geometry: SpanGeometry): Selection {
    const {sx, sy} = geometry

    let val: number
    let vs: RaggedArray<FloatArray>
    if (geometry.direction == "v") {
      val = this.renderer.yscale.invert(sy)
      vs = this._ys
    } else {
      val = this.renderer.xscale.invert(sx)
      vs = this._xs
    }

    const hits: Map<number, number[]> = new Map()
    for (let i = 0, end = vs.length; i < end; i++) {
      const vsi = vs.get(i)
      const points: number[] = []
      for (let j = 0, endj = vsi.length - 1; j < endj; j++) {
        if (vsi[j] <= val && val <= vsi[j + 1])
          points.push(j)
      }
      if (points.length > 0) {
        hits.set(i, points)
      }
    }

    return new Selection({
      indices: [...hits.keys()],
      multiline_indices: to_object(hits), // TODO: remove to_object()
    })
  }

  get_interpolation_hit(i: number, point_i: number, geometry: PointGeometry | SpanGeometry): [number, number] {
    const xsi = this._xs.get(i)
    const ysi = this._ys.get(i)
    const x2 = xsi[point_i]
    const y2 = ysi[point_i]
    const x3 = xsi[point_i + 1]
    const y3 = ysi[point_i + 1]
    return line_interpolation(this.renderer, geometry, x2, y2, x3, y3)
  }

  override draw_legend_for_index(ctx: Context2d, bbox: Rect, index: number): void {
    generic_line_vector_legend(this.visuals, ctx, bbox, index)
  }

  scenterxy(): [number, number] {
    throw new Error(`${this}.scenterxy() is not implemented`)
  }
}

export namespace MultiLine {
  export type Attrs = p.AttrsOf<Props>

  export type Props = Glyph.Props & {
    xs: p.CoordinateSeqSpec
    ys: p.CoordinateSeqSpec
  } & Mixins

  export type Mixins = LineVector

  export type Visuals = Glyph.Visuals & {line: visuals.LineVector}
}

export interface MultiLine extends MultiLine.Attrs {}

export class MultiLine extends Glyph {
  declare properties: MultiLine.Props
  declare __view_type__: MultiLineView

  constructor(attrs?: Partial<MultiLine.Attrs>) {
    super(attrs)
  }

  static {
    this.prototype.default_view = MultiLineView

    this.define<MultiLine.Props>(({}) => ({
      xs: [ p.XCoordinateSeqSpec, {field: "xs"} ],
      ys: [ p.YCoordinateSeqSpec, {field: "ys"} ],
    }))
    this.mixins<MultiLine.Mixins>(LineVector)
  }
}
