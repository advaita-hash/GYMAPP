// Chart wrappers implementing the dataviz method on the validated dark palette:
// one axis, thin marks (2px lines, ≥8px hover targets, 4px rounded bar ends at the
// baseline with 2px gaps), recessive grid/axes, hover tooltips by default, a legend
// whenever ≥2 series (identity never by color alone — series are also direct-labeled
// by the legend + tooltip), and all text in ink tokens rather than series colors.
// Series colors must be passed in from stable entity slots (Member.color).

import type { ReactNode } from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { CHART } from '../lib/types'

export interface Series {
  key: string
  label: string
  color: string
}

const axisTick = { fill: CHART.muted, fontSize: 11 }

function ChartTooltip({ active, payload, label, unit }: any) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="bg-raised border border-line rounded-xl px-3 py-2 text-xs shadow-xl">
      <div className="text-faint mb-1">{label}</div>
      {payload
        .filter((p: any) => p.value != null)
        .map((p: any) => (
          <div key={p.dataKey} className="flex items-center gap-2 py-0.5">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: p.color || p.fill }} />
            <span className="text-sub">{p.name}</span>
            <span className="ml-auto font-semibold text-ink pl-3">
              {typeof p.value === 'number' ? Math.round(p.value * 10) / 10 : p.value}
              {unit ? ` ${unit}` : ''}
            </span>
          </div>
        ))}
    </div>
  )
}

export function ChartLegend({ series }: { series: Series[] }) {
  if (series.length < 2) return null
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 px-1">
      {series.map((s) => (
        <span key={s.key} className="flex items-center gap-1.5 text-[11px] text-sub">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  )
}

/**
 * Multi-series line chart over ordered categories (dates). `data` rows:
 * { label: string, [seriesKey]: number | null }.
 */
export function TrendChart({
  data, series, unit, height = 200, yDomain,
}: {
  data: Record<string, any>[]
  series: Series[]
  unit?: string
  height?: number
  yDomain?: [number | 'auto', number | 'auto']
}) {
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid stroke={CHART.grid} strokeWidth={1} vertical={false} />
          <XAxis
            dataKey="label"
            tick={axisTick}
            tickLine={false}
            axisLine={{ stroke: CHART.axis }}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            width={46}
            domain={yDomain ?? ['auto', 'auto']}
          />
          <Tooltip content={<ChartTooltip unit={unit} />} cursor={{ stroke: CHART.axis, strokeWidth: 1 }} />
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: CHART.surface }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <ChartLegend series={series} />
    </div>
  )
}

/**
 * Horizontal category bars (one value per entity, e.g. weekly points per member).
 * Bars carry per-entity colors; a visible value label rides each bar, so identity
 * and magnitude never rely on color alone.
 */
export function EntityBars({
  data, unit, height,
}: {
  data: { name: string; value: number; color: string }[]
  unit?: string
  height?: number
}) {
  const h = height ?? Math.max(120, data.length * 44)
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 42, bottom: 0, left: 8 }} barCategoryGap={8}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fill: CHART.sub, fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          width={72}
        />
        <Tooltip content={<ChartTooltip unit={unit} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
        <Bar
          dataKey="value"
          name={unit ?? 'value'}
          radius={[0, 4, 4, 0]}
          barSize={16}
          label={{ position: 'right', fill: CHART.ink, fontSize: 11, formatter: (v: number) => Math.round(v) }}
        >
          {data.map((d, i) => (
            <Cell key={i} fill={d.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/**
 * Vertical bars over ordered categories (e.g. points per week). Single series,
 * single hue from the sequential ramp — no legend needed.
 */
export function CategoryBars({
  data, unit, color = CHART.seq[2], height = 180, referenceY,
}: {
  data: { label: string; value: number }[]
  unit?: string
  color?: string
  height?: number
  referenceY?: { value: number; label: string }
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }} barCategoryGap={4}>
        <CartesianGrid stroke={CHART.grid} strokeWidth={1} vertical={false} />
        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: CHART.axis }} minTickGap={16} />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} width={46} />
        <Tooltip content={<ChartTooltip unit={unit} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
        {referenceY && (
          <ReferenceLine
            y={referenceY.value}
            stroke={CHART.muted}
            strokeDasharray="4 4"
            label={{ value: referenceY.label, fill: CHART.muted, fontSize: 10, position: 'insideTopRight' }}
          />
        )}
        <Bar dataKey="value" name={unit ?? 'value'} fill={color} radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  )
}

/** A stat tile: when the data's job is a single headline number, not a chart. */
export function StatTile({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: string; accent?: boolean }) {
  return (
    <div className="bg-surface border border-line rounded-2xl p-3">
      <div className="text-[11px] text-faint font-medium">{label}</div>
      <div className={`text-2xl font-extrabold mt-0.5 ${accent ? 'text-accent' : 'text-ink'}`}>{value}</div>
      {sub && <div className="text-[11px] text-sub mt-0.5">{sub}</div>}
    </div>
  )
}
