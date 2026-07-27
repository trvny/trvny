[Net.ServicePointManager]::SecurityProtocol =
    [Net.ServicePointManager]::SecurityProtocol -bor
    [Net.SecurityProtocolType]::Tls12
$OutputEncoding = [System.Text.UTF8Encoding]::new()
try {
    [Console]::OutputEncoding = $OutputEncoding
    [Console]::InputEncoding  = $OutputEncoding
} catch { }   # brak realnej konsoli - przekierowane stdin/stdout