export function CountryFlag({ country, name = '', className = '' }) {
  if (!country) return null;
  const code = String(country).toLowerCase();
  return (
    <img
      src={`https://flagcdn.com/w40/${code}.png`}
      srcSet={`https://flagcdn.com/w80/${code}.png 2x`}
      alt={name ? `${name} flag` : ''}
      width={20}
      height={15}
      className={`inline-block h-[15px] w-5 shrink-0 rounded-[2px] object-cover shadow-sm ${className}`}
    />
  );
}
