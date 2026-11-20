'use client';

import { Users, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import type { Person, Teammates } from '../lib/api';
import styles from './PeoplePicker.module.css';

type Option = { key: string; label: string; detail: string; people: Person[] };

// Chooses who to invite to a booking from the people who share a team with
// the signed-in member, one at a time or a whole team at once. `selected` can
// include people who are no longer teammates; they stay until removed.
export function PeoplePicker({
  selected,
  onChange,
  capacity,
  disabled = false,
}: {
  selected: Person[];
  onChange: (people: Person[]) => void;
  capacity: number;
  disabled?: boolean;
}) {
  const [teammates, setTeammates] = useState<Teammates>();
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const id = useId();

  useEffect(() => {
    const request = new AbortController();

    api<Teammates>('/teammates', { signal: request.signal })
      .then(setTeammates)
      .catch((error) => {
        if (!request.signal.aborted) setError(errorMessage(error));
      });

    return () => request.abort();
  }, []);

  const chosen = new Set(selected.map((person) => person.id));
  const search = query.trim().toLowerCase();
  const matches = (...texts: string[]) =>
    texts.some((text) => text.toLowerCase().includes(search));
  const byId = new Map(teammates?.people.map((person) => [person.id, person]));

  const options: Option[] = [
    ...(teammates?.teams ?? [])
      .map((team) => ({
        team,
        missing: team.memberIds.filter((member) => !chosen.has(member)),
      }))
      .filter(({ team, missing }) => missing.length && matches(team.name))
      .map(({ team, missing }) => ({
        key: 'team:' + team.id,
        label: `Everyone in ${team.name}`,
        detail: `${missing.length} ${missing.length === 1 ? 'person' : 'people'}`,
        people: missing.map((member) => byId.get(member)!),
      })),
    ...(teammates?.people ?? [])
      .filter(
        (person) =>
          !chosen.has(person.id) && matches(person.name, person.email),
      )
      .map((person) => ({
        key: person.id,
        label: person.name,
        detail: person.email,
        people: [{ id: person.id, name: person.name }],
      })),
  ];

  const showOptions = open && options.length > 0;
  const current = Math.min(active, options.length - 1);
  const seats = selected.length + 1;
  const full = seats > capacity;

  function add(option: Option) {
    onChange([
      ...selected,
      ...option.people.map(({ id, name }) => ({ id, name })),
    ]);
    setQuery('');
    setActive(0);
  }

  function remove(person: Person) {
    onChange(selected.filter((other) => other.id !== person.id));
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive(
        (current + step + options.length) % Math.max(options.length, 1),
      );
    } else if (event.key === 'Enter') {
      // Never submit a surrounding form from here.
      event.preventDefault();
      if (showOptions) add(options[current]);
    } else if (event.key === 'Escape' && showOptions) {
      // Close the suggestions, not the dialog around them.
      event.preventDefault();
      setOpen(false);
    } else if (event.key === 'Backspace' && !query && selected.length) {
      remove(selected[selected.length - 1]);
    }
  }

  const optionId = (index: number) => `${id}-option-${index}`;

  return (
    <div className={styles.picker}>
      <div className={styles.heading}>
        <label htmlFor={`${id}-input`}>Who’s coming?</label>
        <span data-full={full}>
          {seats} of {capacity} {capacity === 1 ? 'seat' : 'seats'}
        </span>
      </div>

      {selected.length > 0 && (
        <ul className={styles.chips} aria-label="Invited">
          {selected.map((person) => (
            <li key={person.id}>
              {person.name}
              <button
                type="button"
                aria-label={`Remove ${person.name}`}
                disabled={disabled}
                onClick={() => remove(person)}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {teammates && teammates.people.length === 0 ? (
        <p className={styles.hint}>
          <Users size={15} /> To invite people, create a team under Teams.
        </p>
      ) : (
        <input
          id={`${id}-input`}
          role="combobox"
          aria-expanded={showOptions}
          aria-controls={`${id}-options`}
          aria-autocomplete="list"
          aria-activedescendant={showOptions ? optionId(current) : undefined}
          autoComplete="off"
          placeholder="Add people or a team"
          disabled={disabled || !teammates}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={keyDown}
        />
      )}

      {showOptions && (
        <ul id={`${id}-options`} role="listbox" className={styles.options}>
          {options.map((option, index) => (
            <li
              key={option.key}
              id={optionId(index)}
              role="option"
              aria-selected={index === current}
              // Keep focus in the input so typing can continue.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => add(option)}
              onMouseEnter={() => setActive(index)}
            >
              <strong>{option.label}</strong>
              <span>{option.detail}</span>
            </li>
          ))}
        </ul>
      )}

      {open && search && options.length === 0 && teammates && (
        <p className={styles.hint}>No teammates match “{query.trim()}”.</p>
      )}
      {full && (
        <p className="error" role="alert">
          That’s more people than the room fits. Remove someone or choose a
          bigger room.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
