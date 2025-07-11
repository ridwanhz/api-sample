provider "aws" {
  region = "ap-southeast-1"
}

resource "aws_key_pair" "deployer" {
  key_name   = "deployer-key"
  public_key = file("~/.ssh/id_rsa.pub") # Ganti sesuai keypair kamu
}

resource "aws_security_group" "minikube_sg" {
  name        = "minikube-sg"
  description = "Allow SSH, HTTP, Jenkins"

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 8080
    to_port     = 8080
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_instance" "minikube_stack" {
  ami                    = "ami-0fc5d935ebf8bc3bc" # Ubuntu 24.04
  instance_type          = "t3.medium"
  key_name               = aws_key_pair.deployer.key_name
  vpc_security_group_ids = [aws_security_group.minikube_sg.id]

  user_data = file("init-minikube-stack-dynamic.sh")

  tags = {
    Name = "minikube-jenkins"
  }
}

output "public_ip" {
  value       = aws_instance.minikube_stack.public_ip
  description = "Public IP of the EC2 instance"
}
