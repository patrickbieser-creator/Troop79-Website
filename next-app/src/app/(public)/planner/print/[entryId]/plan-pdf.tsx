/**
 * The printed meeting plan as a PDF (Patrick, 2026-11-09), drawn from lib/meeting-print's model with
 * @react-pdf/renderer. Landscape Letter, built-in Helvetica (WinAnsi: no ☐/✓ glyphs, so the boxes are drawn).
 *
 * A PDF can't read CSS custom properties, so PDF_COLORS copies the few public tokens it needs (globals.css: --navy,
 * --forest, --text-meta, --border-mid, --rule, --status-success-bg). Change them there first, then here.
 */
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { PrintCell, PrintPlan } from '@/lib/meeting-print';

const PDF_COLORS = {
  navy: '#1e3a4a',
  ink: '#1f1f1f',
  meta: '#787060',
  border: '#c8bfaf',
  rule: '#e4d9c4',
  done: '#3d5a3e',
  doneBg: '#eef2ee'
};

const s = StyleSheet.create({
  page: { padding: 28, fontFamily: 'Helvetica', fontSize: 9, color: PDF_COLORS.ink },
  kicker: { fontSize: 8, color: PDF_COLORS.meta, marginBottom: 2 },
  h1: { fontFamily: 'Helvetica-Bold', fontSize: 15, color: PDF_COLORS.navy },
  sub: { fontSize: 10, marginTop: 2 },
  legend: { flexDirection: 'row', alignItems: 'center', marginTop: 6, marginBottom: 10, fontSize: 8, color: PDF_COLORS.meta },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: 12 },
  section: { marginBottom: 12 },
  secHead: { flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: PDF_COLORS.navy, paddingBottom: 2, marginBottom: 3 },
  secTitle: { fontFamily: 'Helvetica-Bold', fontSize: 11, color: PDF_COLORS.navy },
  secMeta: { fontSize: 8, color: PDF_COLORS.meta },
  tr: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 0.5, borderBottomColor: PDF_COLORS.rule, minHeight: 16 },
  th: { fontFamily: 'Helvetica-Bold', fontSize: 8 },
  name: { width: 130, paddingRight: 4 },
  rank: { width: 62, fontSize: 7, color: PDF_COLORS.meta },
  cell: { width: 24, alignItems: 'center', justifyContent: 'center' },
  note: { flex: 1, fontSize: 7, color: PDF_COLORS.meta, paddingLeft: 4 },
  stationHead: { fontFamily: 'Helvetica-Bold', fontSize: 7, textAlign: 'center' },
  box: { width: 10, height: 10, borderWidth: 1, borderColor: PDF_COLORS.ink },
  boxDone: { width: 10, height: 10, borderWidth: 1, borderColor: PDF_COLORS.done, backgroundColor: PDF_COLORS.done },
  boxPart: { width: 10, height: 10, borderWidth: 1, borderColor: PDF_COLORS.done, flexDirection: 'row' },
  half: { width: 4, height: 8, backgroundColor: PDF_COLORS.done },
  keyLine: { fontSize: 7, color: PDF_COLORS.meta, marginTop: 3 },
  keyCode: { fontFamily: 'Helvetica-Bold', color: PDF_COLORS.ink },
  classRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: PDF_COLORS.rule, paddingVertical: 3 },
  classTitle: { width: 190, fontFamily: 'Helvetica-Bold' },
  classTeachers: { width: 150, fontSize: 8 },
  classScouts: { flex: 1, fontSize: 8 },
  scoutTick: { flexDirection: 'row', alignItems: 'center', marginRight: 10, marginBottom: 2 },
  tickName: { marginLeft: 3 },
  wrapRow: { flex: 1, flexDirection: 'row', flexWrap: 'wrap' },
  footer: { position: 'absolute', bottom: 14, left: 28, right: 28, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: PDF_COLORS.meta }
});

function Box({ cell }: { cell: PrintCell }) {
  if (cell === 'done') return <View style={s.boxDone} />;
  if (cell === 'part') {
    return (
      <View style={s.boxPart}>
        <View style={s.half} />
      </View>
    );
  }
  return <View style={s.box} />;
}

/** "4a Show first aid for… · 4b Describe…": the codes in a table, spelled out under it. */
function Key({ columns }: { columns: { code: string; label: string }[] }) {
  if (!columns.length) return null;
  return (
    <Text style={s.keyLine}>
      {columns.map((c, i) => (
        <Text key={`${c.code}-${i}`}>
          <Text style={s.keyCode}>{c.code}</Text> {c.label.length > 90 ? `${c.label.slice(0, 88)}…` : c.label}
          {i < columns.length - 1 ? '   ·   ' : ''}
        </Text>
      ))}
    </Text>
  );
}

export function PlanPdf({ plan }: { plan: PrintPlan }) {
  return (
    <Document title={`Meeting plan — ${plan.dateLabel}`} author="Scout Troop 79" subject="Meeting plan and advancement cross-check">
      <Page size="LETTER" orientation="landscape" style={s.page} wrap>
        <Text style={s.kicker}>Scout Troop 79 · Meeting plan and advancement cross-check</Text>
        <Text style={s.h1}>
          {plan.dateLabel} · {plan.focus}
        </Text>
        <Text style={s.sub}>{plan.title}</Text>
        <View style={s.legend}>
          <View style={s.legendItem}>
            <Box cell="todo" />
            <Text> Planned: tick when signed off</Text>
          </View>
          <View style={s.legendItem}>
            <Box cell="part" />
            <Text> Partly done before the meeting</Text>
          </View>
          <View style={s.legendItem}>
            <Box cell="done" />
            <Text> Done before the meeting</Text>
          </View>
        </View>

        {plan.stations ? (
          <View style={s.section}>
            <View style={s.secHead}>
              <Text style={s.secTitle}>Stations · {plan.stations.badgeName}</Text>
              <Text style={s.secMeta}>{plan.stations.stations.map((x, i) => `${i + 1}. ${x.title}: ${x.teachers}`).join('   ')}</Text>
            </View>
            {plan.stations.groups.map((g) => (
              <View key={g.name} style={s.section} wrap={false}>
                <Text style={s.th}>
                  {g.name} <Text style={s.secMeta}>{g.sub}</Text>
                </Text>
                <View style={s.tr}>
                  <Text style={[s.name, s.th]}>Scout</Text>
                  {plan.stations!.stations.flatMap((x, i) => x.cells.map((c) => <Text key={`${i}-${c.code}`} style={[s.cell, s.stationHead]}>{`${i + 1}·${c.code}`}</Text>))}
                </View>
                {g.rows.map((r) => (
                  <View key={r.name} style={s.tr}>
                    <Text style={s.name}>{r.name}</Text>
                    {r.cells.map((c, i) => (
                      <View key={i} style={s.cell}>
                        <Box cell={c} />
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            ))}
            <Key columns={plan.stations.stations.flatMap((x, i) => x.cells.map((c) => ({ code: `${i + 1}·${c.code}`, label: c.label })))} />
          </View>
        ) : null}

        {plan.sections.map((sec) => (
          <View key={sec.title} style={s.section} wrap={sec.rows.length > 18}>
            <View style={s.secHead}>
              <Text style={s.secTitle}>{sec.title}</Text>
              {sec.teachers ? <Text style={s.secMeta}>Teaching: {sec.teachers}</Text> : null}
            </View>
            <View style={s.tr}>
              <Text style={[s.name, s.th]}>Scout</Text>
              <Text style={[s.rank, s.th]}>Rank</Text>
              {sec.columns.map((c, i) => (
                <Text key={`${c.code}-${i}`} style={[s.cell, s.th]}>
                  {c.code}
                </Text>
              ))}
              <Text style={[s.note, s.th]}>Tonight</Text>
            </View>
            {sec.rows.map((r) => (
              <View key={r.name} style={s.tr} wrap={false}>
                <Text style={s.name}>{r.name}</Text>
                <Text style={s.rank}>{r.rankName}</Text>
                {r.cells.map((c, i) => (
                  <View key={i} style={s.cell}>
                    <Box cell={c} />
                  </View>
                ))}
                <Text style={s.note}>{r.note}</Text>
              </View>
            ))}
            <Key columns={sec.columns} />
          </View>
        ))}

        {plan.classes.length ? (
          <View style={s.section}>
            <View style={s.secHead}>
              <Text style={s.secTitle}>Other classes, conferences and boards</Text>
            </View>
            {plan.classes.map((c) => (
              <View key={c.label} style={s.classRow} wrap={false}>
                <Text style={s.classTitle}>{c.label}</Text>
                <Text style={s.classTeachers}>{c.teachers}</Text>
                <View style={s.wrapRow}>
                  {c.scouts.length ? (
                    c.scouts.map((n) => (
                      <View key={n} style={s.scoutTick}>
                        <Box cell="todo" />
                        <Text style={s.tickName}>{n}</Text>
                      </View>
                    ))
                  ) : (
                    <Text style={s.secMeta}>No scouts yet</Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {plan.cantCome.length ? <Text style={s.keyLine}>Can’t come: {plan.cantCome.join(', ')}</Text> : null}

        <View style={s.footer} fixed>
          <Text>Printed {plan.printedAt} · Advancement as of the start of the meeting</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
