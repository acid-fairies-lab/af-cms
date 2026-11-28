window.CMS.registerCustomPage({
  id: 'stg',
  label: 'Preview STG',
  icon: 'visibility',
  url: './preview.html',
})
window.CMS.registerCustomPage({
  id: 'publish',
  label: 'Publish PROD',
  icon: 'publish',
  url: './publish.html',
})

const SelectControl = window.CMS.getFieldType('select').control

window.CMS.registerFieldType('supported-country', ({ entry, field, forID, value, onChange }) => {
  const selected = entry.getIn(['data', 'supportedCountries'])?.toJS() ?? []
  const used = (entry.getIn(['data', 'shippingExceptions'])?.toJS() ?? []).map(exception => exception.country)
  const options = field.get('options').toJS().filter(option => selected.includes(option.value) && (option.value === value || !used.includes(option.value)))
  return window.CMS.React.createElement(SelectControl, {
    field: { name: field.get('name'), options },
    forID,
    value,
    onChange,
  })
}, ({ field, value }) => field.get('options').toJS().find(option => option.value === value)?.label ?? value, { properties: { options: { type: 'array', items: { type: 'object' } } } })
