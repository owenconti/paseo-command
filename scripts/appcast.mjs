/** The Sparkle appcast for one release: a single-item RSS feed the installed app polls. */

const escapeXML = (text) =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A CDATA section cannot contain its own terminator, so split it across two sections. */
const cdata = (html) => `<![CDATA[${String(html).replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`;

export function appcastXML({
  version,
  build,
  date,
  url,
  length,
  edSignature,
  notesHTML,
  minimumSystemVersion = '14.0',
  title = `Paseo Command ${version}`,
}) {
  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Paseo Command</title>
    <item>
      <title>${escapeXML(title)}</title>
      <pubDate>${new Date(date).toUTCString().replace('GMT', '+0000')}</pubDate>
      <sparkle:minimumSystemVersion>${escapeXML(minimumSystemVersion)}</sparkle:minimumSystemVersion>
      <description>${cdata(notesHTML)}</description>
      <enclosure url="${escapeXML(url)}" length="${escapeXML(length)}" type="application/octet-stream" sparkle:version="${escapeXML(build)}" sparkle:shortVersionString="${escapeXML(version)}" sparkle:edSignature="${escapeXML(edSignature)}"/>
    </item>
  </channel>
</rss>
`;
}
