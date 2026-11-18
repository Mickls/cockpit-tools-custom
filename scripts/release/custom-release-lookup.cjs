function findRelease(gh, repo, tag) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error('Invalid release tag');
  const endpoint = `repos/${repo}/releases`;
  try {
    return JSON.parse(gh(['api', `${endpoint}/tags/${tag}`]));
  } catch (error) {
    if (!error.message.includes('HTTP 404')) throw error;
  }
  // The tag endpoint only returns published releases. Find drafts by ID.
  const ids = gh(['api', `${endpoint}?per_page=100`, '--paginate', '--jq',
    `.[] | select(.tag_name == ${JSON.stringify(tag)}) | .id`]).trim().split(/\s+/).filter(Boolean);
  if (!ids.length) return null;
  if (ids.length !== 1 || !/^[1-9]\d*$/.test(ids[0])) throw new Error(`Ambiguous release ID for ${tag}`);
  const release = JSON.parse(gh(['api', `${endpoint}/${ids[0]}`]));
  if (release.tag_name !== tag || String(release.id) !== ids[0]) throw new Error(`Release identity changed for ${tag}`);
  return release;
}

module.exports = { findRelease };
