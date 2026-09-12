# GitHub multi-cuenta (Windows) + panel KawaiiGPT

## Por qué "pierde" la config

Con dos llaves SSH, el agente ofrece la **primera** que GitHub acepta. Si no es la de esa cuenta → `Permission denied` o push a la cuenta equivocada.

## Best practice

1. Llaves separadas, p. ej.:
   - `~/.ssh/id_rsa_orionethan`
   - `~/.ssh/id_rsa_armandohoyos`
2. `%USERPROFILE%\.ssh\config`:

```
Host github-orionethan
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_rsa_orionethan
  IdentitiesOnly yes

Host github-armandohoyos
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_rsa_armandohoyos
  IdentitiesOnly yes
```

3. En **cada repo**, o bien:
   - remote `git@github-orionethan:USER/REPO.git`, o
   - `git config core.sshCommand "ssh -i C:/Users/.../.ssh/id_rsa_orionethan -o IdentitiesOnly=yes"`

El botón **GitHub** en KawaiiGPT escribe `core.sshCommand` + `user.name`/`email` **solo en este repo** y guarda `.kawaii-git-identity.json`.

4. Public key en GitHub → Settings → SSH keys (cuenta correcta).

5. Prueba: panel → **Probar auth** o `ssh -T git@github-orionethan`.

## Panel en la app

**GitHub** (barra superior, estilo violeta) → identidad → **git add -A + commit + push** (force opcional con doble confirmación).
