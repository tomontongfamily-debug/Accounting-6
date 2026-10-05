import {fuelLeakPriceOptions, pumpSaleLiters} from './fuel-leak-loss.js';

const liters = value => Number(value || 0).toLocaleString('en-PH', {minimumFractionDigits: 2, maximumFractionDigits: 2});

export function FuelLeakLoss({report, onChange}) {
  const rows = report.fuelLeakLosses || [];
  const editable = Boolean(onChange) && !report.confirmed;
  const patch = (id, changes) => onChange(rows.map(row => row.id === id ? {...row, ...changes} : row));
  if (!editable && !rows.length) return null;
  return <section aria-label="Fuel Leak Loss" className="section">
    <h3>Fuel Leak Loss</h3>
    <p>Record liters lost and their source. Pump-metered loss is excluded from paid sales; tank loss outside the pump meter reduces expected tank inventory. Actual readings stay unchanged.</p>
    <div className="table-wrap"><table><thead><tr><th>Product</th><th>Loss source</th><th>Leak loss (L)</th><th>Price at loss / L</th><th>Explanation</th>{editable && <th>Action</th>}</tr></thead>
      <tbody>{rows.map(row => {
        const pump = report.pumpRows.find(pump => pump.id === row.pumpRowId);
        const prices = fuelLeakPriceOptions(report, row.product);
        return <tr key={row.id}>
          <td>{editable ? <select aria-label="Leak loss product" value={row.product} onChange={event => patch(row.id, {product: event.target.value, pumpRowId: ''})}>{report.tankRows.map(tank => <option key={tank.id} value={tank.product}>{tank.product}</option>)}</select> : row.product}</td>
          <td>{editable ? <select aria-label="Leak loss source" value={row.pumpRowId || ''} onChange={event => patch(row.id, {pumpRowId: event.target.value})}><option value="">Tank / piping — outside pump meter</option>{report.pumpRows.filter(pump => pump.product === row.product).map(pump => <option key={pump.id} value={pump.id}>{pump.pump} · {pump.nozzle} — metered</option>)}</select> : pump ? `${pump.pump} · ${pump.nozzle} (metered)` : 'Tank / piping (outside pump meter)'}</td>
          <td>{editable ? <input aria-label="Fuel leak loss liters" type="number" min="0" step="0.01" value={row.liters} onChange={event => patch(row.id, {liters: event.target.value})} /> : <b>{liters(row.liters)} L</b>}</td>
          <td>{!pump ? '—' : editable && prices.length > 1 ? <select aria-label="Selling price at leak loss" value={row.pricePerLiter || ''} onChange={event => patch(row.id, {pricePerLiter: event.target.value})}><option value="">Select price at loss</option>{prices.map(price => <option key={price} value={price}>{price.toFixed(2)}</option>)}</select> : Number(prices.length === 1 ? prices[0] : row.pricePerLiter || 0).toFixed(2)}</td>
          <td>{editable ? <input aria-label="Fuel leak loss explanation" value={row.notes || ''} maxLength={500} onChange={event => patch(row.id, {notes: event.target.value})} /> : row.notes}</td>
          {editable && <td><button type="button" className="secondary" onClick={() => onChange(rows.filter(loss => loss.id !== row.id))}>Remove loss</button></td>}
        </tr>;
      })}</tbody></table></div>
    {!rows.length && <p>No fuel leak loss recorded.</p>}
    {editable && <button type="button" className="secondary" onClick={() => onChange([...rows, {id: crypto.randomUUID(), product: 'Regular', pumpRowId: '', liters: '', notes: ''}])}>Add Fuel Leak Loss</button>}
    {rows.filter(row => row.pumpRowId).map(row => {
      const pump = report.pumpRows.find(pump => pump.id === row.pumpRowId);
      return pump && <p key={row.id}>{pump.pump} · {pump.nozzle}: paid-sale liters after loss = <b>{liters(pumpSaleLiters(report, pump))} L</b>.</p>;
    })}
  </section>;
}
