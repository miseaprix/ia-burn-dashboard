import React from 'react';

const number = new Intl.NumberFormat('fr-FR');

export default function MonitoringPagination({ label, offset, limit, total, href }) {
  if (total <= limit && offset === 0) return null;
  return (
    <nav className="monitor-pagination" aria-label={`Pagination des ${label}`}>
      {offset > 0 && <a href={href(Math.max(0, offset - limit))}>Précédent</a>}
      <span>{offset < total
        ? `${number.format(offset + 1)}–${number.format(Math.min(offset + limit, total))} sur ${number.format(total)}`
        : 'Aucun résultat sur cette page'}</span>
      {offset + limit < total && <a href={href(offset + limit)}>Suivant</a>}
    </nav>
  );
}
