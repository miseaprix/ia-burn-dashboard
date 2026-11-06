import React from 'react';
export default function Footer({ period, footnote }) {
  return (
    <footer className="footer">
      <span>ⓘ &nbsp; {footnote}</span>
      {period?.from && period?.to && (
        <span className="tabnum">
          {period.from} – {period.to}
        </span>
      )}
    </footer>
  );
}
