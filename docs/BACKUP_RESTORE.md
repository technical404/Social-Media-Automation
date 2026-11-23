# Backup and restore

```
python main.py --backup
python main.py --stop
python main.py --restore path\to\file.sqlite --yes
```

Restore always writes a `before-restore` safety copy first.
