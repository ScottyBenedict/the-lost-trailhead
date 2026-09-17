import { hikes } from '../../data/hikes'
import { unslugify } from '../../lib/adminUtils'

// <option>/<optgroup> contents for a hike-picking <select>, shared by
// LogTripTab and MapsTab's GPX uploader — both list every published hike,
// plus (when given) hikes that exist in Supabase but have no page yet.
export default function HikeOptions({ pendingHikeIds = [] }) {
  return (
    <>
      <option value="">— choose a hike —</option>
      <optgroup label="Published hikes">
        {hikes.map(h => <option key={h.id} value={h.supabaseId || h.id}>{h.name}</option>)}
      </optgroup>
      {pendingHikeIds.length > 0 && (
        <optgroup label="Needs a page">
          {pendingHikeIds.map(id => <option key={id} value={id}>{unslugify(id)}</option>)}
        </optgroup>
      )}
    </>
  )
}
